import { MongoClient, Colours } from "./deps.ts";

export interface WorkersHashContent {
  websocketID: string;
  websocketURL: string;
  websocketURLExpiryTime: Date;
}

export interface WorkerListObject {
  "created_on": string;
  etag: string;
  handlers: [string];
  id: string;
  "modified_on": string;
  routes: [{
    id: string;
    pattern: string;
    script: string;
    request_limit_fail_open: boolean;
  }];
  "usage_model": string;
}

export interface WorkerTailObject {
  "expires_at": string;
  id: string;
  url: string;
}

// Connect to Mongo
const logDBClient = new MongoClient();
try {
  await logDBClient.connect(Deno.env.get("LOGGING_MONGO_URI") || "");
  console.log("Connected to Mongo")
} catch (err) {
  console.log(err);
}
const logDB = logDBClient.database("cloudflareWorkerLogs");

// Set up cache objects
// Create mongo collection object cache
const workerLogCollectionHash: { [k: string]: ReturnType<typeof logDB.collection> } = {};
// Create websocket cache
const websocketCache: { [k: string]: WebSocket } = {};
// Create setTimeout cache
const websocketTimeoutCache: { [k: string]: number } = {};

// Reconnect connections that currently exist
const { workersHash = {} } = await logDB.collection("metalog").findOne({ _id: "statedocument"}) as { workersHash: { [k: string] : WorkersHashContent} } ?? {};

async function refreshWorkerTailURL (workerID:string) {
  console.log(`Refreshing expiring websocket url for ${workerID}`)
  websocketCache[workerID].close()
  // Delete websocket
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${Deno.env.get("CF_ACCOUNT_ID")}/workers/scripts/${workerID}/tails/${workersHash[workerID].websocketID}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("CF_API_TOKEN")}`
    }
  })

  const {result: {id, url, expires_at: expiresAt}}: { result: WorkerTailObject} = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${Deno.env.get("CF_ACCOUNT_ID")}/workers/scripts/${workerID}/tails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("CF_API_TOKEN")}`
    }
  })).json()
  const websocketURLExpiryTime = new Date(expiresAt)
  workersHash[workerID] = {
    websocketID: id,
    websocketURL: `${url}/ws`,
    websocketURLExpiryTime
  }
  // clear websocket, delete tail and open new websocket
  websocketCache[workerID] = new WebSocket(`${url}/ws`, ['trace-v1'])

  // clear setTimeout and recreate it
  clearTimeout(websocketTimeoutCache[workerID])
  console.log(`New expiry time: ${websocketURLExpiryTime}`)
  const timeoutDuration = (websocketURLExpiryTime.getTime() - new Date().getTime())
  console.log(`New duration to next refresh: ${timeoutDuration}ms`)
  websocketTimeoutCache[workerID] = setTimeout(async () => await refreshWorkerTailURL(workerID), new Date(expiresAt).getTime() - new Date().getTime())
}

async function getLatestWorkersList() {
  console.log("Refreshing apps list");
  try {
    //Get Workers
    const allWorkers: {result: [WorkerListObject]} = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${Deno.env.get("CF_ACCOUNT_ID")}/workers/scripts`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("CF_API_TOKEN")}`
      }
    })).json()
    for (const worker of allWorkers.result) {
      const { id: workerID } = worker
      if (!workersHash[workerID] || workersHash[workerID].websocketURLExpiryTime.getTime() - new Date().getTime() < 0 ) {
        const { result: { id, url, expires_at: expiresAt}}: {result: WorkerTailObject} = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${Deno.env.get("CF_ACCOUNT_ID")}/workers/scripts/${workerID}/tails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("CF_API_TOKEN")}`
          }
        })).json()

        const websocketURLExpiryTime = new Date(expiresAt)
        workersHash[workerID] = {
          websocketID: id,
          websocketURL: `${url}/ws`,
          websocketURLExpiryTime
        }
        if (!workerLogCollectionHash[workerID]) {
          workerLogCollectionHash[workerID] = logDB.collection(`${workerID}-logs`)
        }
        websocketCache[workerID] = new WebSocket(`${url}/ws`, ['trace-v1'])
        websocketCache[workerID].onopen = () => console.log(`Connected to new tail for ${workerID}`)
        websocketCache[workerID].onmessage = async (message) => {
          const log = JSON.parse(await message.data.text())
          await workerLogCollectionHash[workerID].insertOne(Object.assign(log, {eventTimestampDateObject: new Date(log.eventTimestamp)}))
        }
        console.log(`Expiry time: ${websocketURLExpiryTime}`)
        const timeoutDuration = (websocketURLExpiryTime.getTime() - new Date().getTime())
        console.log(`Duration to next refresh: ${timeoutDuration}ms`)
        websocketTimeoutCache[workerID] = setTimeout(async () => await refreshWorkerTailURL(workerID), timeoutDuration)
      }
    }
  } catch (err) {
    console.log(err)
  }
}

// Get latest workers
await getLatestWorkersList()
setInterval(getLatestWorkersList, 600000);

// Set up websocket connections for all the connections that currently have an existing unexpired websocket connection
for (const workerID of Object.keys(workersHash)) {
  if (!websocketCache[workerID]) {
    const { websocketURL, websocketURLExpiryTime } = workersHash[workerID]
    if (!workerLogCollectionHash[workerID]) {
      workerLogCollectionHash[workerID] = logDB.collection(`${workerID}-logs`)
    }
    websocketCache[workerID] = new WebSocket(`${websocketURL}/ws`, ['trace-v1'])
    websocketCache[workerID].onopen = () => console.log(`Reconnected to existing tail for ${workerID}`)
    websocketCache[workerID].onmessage = async (message) => {
      const log = JSON.parse(await message.data.text())
      await workerLogCollectionHash[workerID].insertOne(Object.assign(log, {eventTimestampDateObject: new Date(log.eventTimestamp)}))
    }
    websocketTimeoutCache[workerID] = setTimeout(async () => await refreshWorkerTailURL(workerID), new Date(websocketURLExpiryTime).getTime() - new Date().getTime())
  }
}

console.log("====== BOOT COMPLETE ======");

// Update statedocument
setInterval(async () => {
  await logDB.collection("metalog").updateOne({ _id: "statedocument" }, {
    $set: {
      _id: "statedocument",
      workersHash,
      websocketTimeoutCache,
      lastUpdated: new Date(),
    },
  }, { upsert: true });
}, 10000);
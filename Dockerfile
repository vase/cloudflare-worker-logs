FROM denoland/deno:distroless-1.13.1@sha256:3987ab959b733be74ee7751b8ef61a9ba3e712f55dfc5f04fa0946f516ca8c8b
ENV DENO_ENV=production

WORKDIR /app

# Cache the dependencies as a layer (the following two steps are re-run only when deps.ts is modified).
# Ideally fetch deps.ts will download and compile _all_ external files used in main.ts.
COPY deps.ts .
RUN ["deno", "cache", "deps.ts"]

# These steps will be re-run upon each file change in your working directory:
ADD . .
# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN ["deno", "cache", "main.ts"]

# Optionally prefer not to run as root.
USER nonroot

CMD ["run", "--unstable", "--allow-net", "--allow-env", "main.ts"]
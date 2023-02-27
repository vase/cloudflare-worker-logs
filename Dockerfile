FROM denoland/deno:distroless-1.31.1@sha256:46438d3d82ed777f9e63fe4499c035766d1e5b1c5c4d2bbd0a92cc782e93007d
ENV DENO_ENV=production

WORKDIR /app

# Cache the dependencies as a layer (the following two steps are re-run only when deps.ts is modified).
# Ideally fetch deps.ts will download and compile _all_ external files used in main.ts.
COPY deps.ts .
RUN ["deno", "cache", "--unstable", "deps.ts"]

# These steps will be re-run upon each file change in your working directory:
ADD . .
# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN ["deno", "cache", "--unstable", "main.ts"]

# Optionally prefer not to run as root.
USER nonroot

CMD ["run", "--unstable", "--allow-net", "--allow-env", "main.ts"]
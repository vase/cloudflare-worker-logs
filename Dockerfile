FROM denoland/deno:distroless-1.19.0@sha256:649e87bcc5bf2ce9655961986789e42d25b4eed3e5f1e3164407d9c7cb8182c2
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
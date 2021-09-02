FROM denoland/deno:distroless-1.13.2@sha256:f3d419d773a83976a83c1e5b76fcb6b996cb219b4635578d1d16bcebb8816bee
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
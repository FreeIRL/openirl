FROM debian:bookworm-slim AS build

ARG SRTLA_REF=2b19d400d88f2a35ad225d2ea048c04335e69803

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        ca-certificates cmake g++ git libspdlog-dev make \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --filter=blob:none https://github.com/OpenIRL/srtla.git /src \
    && git -C /src checkout "${SRTLA_REF}" \
    && git -C /src submodule update --init --recursive \
    && cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /src/build --parallel

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y libspdlog1.10 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home srtla

COPY --from=build /src/build/srtla_rec /usr/local/bin/srtla_rec

USER srtla
EXPOSE 5000/udp
ENTRYPOINT ["/usr/local/bin/srtla_rec"]

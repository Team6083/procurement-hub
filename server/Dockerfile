# syntax=docker/dockerfile:1
#
# Build context is this directory (server/):
#   docker build --build-arg GO_VERSION="$(sed -n 's/^go //p' go.mod)" \
#     --build-arg VERSION=1.2.3 --build-arg COMMIT="$(git rev-parse HEAD)" .
#
# The Go version lives only in go.mod (spec section 5.1). CI and the release
# workflow always pass it as GO_VERSION; the default below is a fallback for
# plain local builds, and CI fails if it differs from go.mod.
ARG GO_VERSION=1.26.11

FROM golang:${GO_VERSION}-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
ARG VERSION=dev
ARG COMMIT=unknown
ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
    -o /out/procurement-hub ./cmd/procurement-hub

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/procurement-hub /procurement-hub
# Numeric so Kubernetes runAsNonRoot can verify it. The process writes no
# files, so the container runs with a read-only root filesystem.
USER 65532:65532
EXPOSE 8080 9090
ENTRYPOINT ["/procurement-hub"]
# "serve" (default) or "migrate".
CMD ["serve"]

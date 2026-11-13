# syntax=docker/dockerfile:1
# Build context is this directory: docker build -f server/Dockerfile server
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
ARG VERSION=dev
ARG COMMIT=unknown
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
    -o /out/procurement-hub ./cmd/procurement-hub

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/procurement-hub /procurement-hub
USER nonroot:nonroot
EXPOSE 8080 9090
ENTRYPOINT ["/procurement-hub"]
CMD ["serve"]

ARG GO_BASE_IMAGE=golang:1.25-alpine
ARG ALPINE_BASE_IMAGE=alpine:3.22

FROM ${GO_BASE_IMAGE} AS builder

WORKDIR /src

COPY worker/go.mod worker/go.sum* ./
RUN go mod download

COPY worker/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/narra-worker ./cmd/worker
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/narra-prompt-sync ./cmd/prompt-sync
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/narra-rollback-preflight ./cmd/rollback-preflight

FROM ${ALPINE_BASE_IMAGE}

WORKDIR /app

COPY --from=builder /out/narra-worker /app/narra-worker
COPY --from=builder /out/narra-prompt-sync /app/narra-prompt-sync
COPY --from=builder /out/narra-rollback-preflight /app/narra-rollback-preflight

EXPOSE 8081

STOPSIGNAL SIGTERM

CMD ["/app/narra-worker"]

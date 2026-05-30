FROM golang:1.25-alpine AS builder

WORKDIR /src

COPY worker/go.mod worker/go.sum* ./
RUN go mod download

COPY worker/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/narra-worker ./cmd/worker

FROM alpine:3.22

WORKDIR /app

COPY --from=builder /out/narra-worker /app/narra-worker

CMD ["/app/narra-worker"]

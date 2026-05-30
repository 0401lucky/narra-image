package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

	narraw "narra-image-worker/internal/worker"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	cfg, err := narraw.LoadConfig()
	if err != nil {
		logger.Error("配置读取失败", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		logger.Error("数据库连接串解析失败", "error", err)
		os.Exit(1)
	}
	poolConfig.MaxConns = int32(cfg.Concurrency + 2)

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		logger.Error("数据库连接失败", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		logger.Error("数据库不可用", "error", err)
		os.Exit(1)
	}

	worker := narraw.New(pool, cfg, logger)
	if err := worker.Run(ctx); err != nil {
		logger.Error("Worker 异常退出", "error", err)
		os.Exit(1)
	}
}

package worker

import "testing"

func TestNormalizeDatabaseURLMovesPrismaSchema(t *testing.T) {
	got := normalizeDatabaseURL("postgresql://user:pass@localhost:5432/app?schema=public&sslmode=disable")

	if got != "postgresql://user:pass@localhost:5432/app?search_path=public&sslmode=disable" {
		t.Fatalf("unexpected database url: %s", got)
	}
}

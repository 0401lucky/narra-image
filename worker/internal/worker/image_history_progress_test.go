package worker

import (
	"context"
	"testing"
)

type historyProgressRepository struct {
	ImageHistoryReadRepository
	job  ImageHistoryJob
	page ImageHistoryItemsPage
}

func (repo historyProgressRepository) GetImageHistoryJob(context.Context, ImageHistoryJobInput) (*ImageHistoryJob, error) {
	job := repo.job
	return &job, nil
}

func (repo historyProgressRepository) ListImageHistoryItems(context.Context, ImageHistoryItemsInput) (ImageHistoryItemsPage, error) {
	return repo.page, nil
}

func TestImageHistoryReadProgressIncludesUnfinishedClaimedItems(t *testing.T) {
	nextCursor := historyTestItemID
	for _, test := range []struct {
		name       string
		scanDone   bool
		total      int
		completed  int
		blocked    int
		nextCursor *string
		wantMore   bool
	}{
		{name: "claimed item after final scan page", scanDone: true, total: 1, wantMore: true},
		{name: "one claimed item among completed items", scanDone: true, total: 2, completed: 1, wantMore: true},
		{name: "scan has more candidates", wantMore: true},
		{name: "blocked item", scanDone: true, total: 1, blocked: 1, wantMore: true},
		{name: "completed job has another report page", scanDone: true, total: 2, completed: 2, nextCursor: &nextCursor, wantMore: true},
		{name: "completed job final page", scanDone: true, total: 1, completed: 1},
		{name: "empty completed scan", scanDone: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := historyProgressRepository{
				job: ImageHistoryJob{ID: historyTestJobID, ScanComplete: test.scanDone,
					TotalItems: test.total, CompletedItems: test.completed, BlockedItems: test.blocked},
				page: ImageHistoryItemsPage{Items: []ImageHistoryItem{}, NextCursor: test.nextCursor},
			}
			report, err := ReadImageHistoryProgress(context.Background(), repository, historyTestJobID, "", 100)
			if err != nil {
				t.Fatal(err)
			}
			if report.HasMore != test.wantMore || !report.DryRun || report.Processed != 0 {
				t.Fatalf("read-only progress incorrectly describes remaining work: %+v", report)
			}
			if report.Job.CompletedItems != test.completed || report.Job.TotalItems != test.total || report.NextCursor != test.nextCursor {
				t.Fatalf("read-only progress lost persisted counts or pagination: %+v", report)
			}
		})
	}
}

package worker

import (
	"context"
	"os"
	"strconv"
	"time"
)

type imageHistoryLocalStore struct {
	local    *LocalImageStore
	location ImageLocationInput
}

func (store *imageHistoryLocalStore) Verify(ctx context.Context) error {
	_, err := store.local.Verify(ctx)
	return err
}

func (store *imageHistoryLocalStore) Inspect(ctx context.Context, key string, expected *ImageHistoryExpectedContent, keepData bool) (ImageHistoryInspection, error) {
	root, err := store.local.openRoot(ctx)
	if err != nil {
		return ImageHistoryInspection{ReadResult: "FAILED", VersionEvidence: "UNKNOWN"}, err
	}
	defer root.Close()
	return store.inspectRoot(ctx, root, key, expected, keepData)
}

// The root capability is read-only even in tests. Reusing the LOCAL store's
// marker, no-stage, open-and-SameFile guards keeps observation as strict as its
// normal readers without pretending a previously known SHA is a readback.
func (store *imageHistoryLocalStore) inspectRoot(ctx context.Context, root localImageReadRoot, key string, expected *ImageHistoryExpectedContent, keepData bool) (ImageHistoryInspection, error) {
	result := ImageHistoryInspection{ReadResult: "UNVERIFIED", VersionEvidence: "UNKNOWN"}
	objectName, stageName, err := LocalImageObjectNames(key)
	if err != nil {
		return result, err
	}
	if err := store.local.verifyMarker(ctx, root); err != nil {
		return result, err
	}
	if err := localImageNoPending(root, stageName); err != nil {
		return result, err
	}
	before, err := localImageStat(root, objectName)
	if err != nil {
		return result, err
	}
	if before == nil {
		if err := store.local.verifyMarker(ctx, root); err != nil {
			return result, err
		}
		if err := localImageNoPending(root, stageName); err != nil {
			return result, err
		}
		result.ReadResult = "MISSING"
		return result, localImageError("LOCAL_IMAGE_NOT_FOUND")
	}
	if !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 {
		return result, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	length := before.Size()
	result.ByteLength = &length
	if length < 1 || length > ImageHistoryObservationMaxBytes {
		return result, ImageHistoryIOError{Code: "OBSERVATION_TOO_LARGE"}
	}
	file, identity, err := openLocalImageRegular(root, objectName, length)
	if err != nil {
		return result, err
	}
	defer file.Close()
	stopAbort := context.AfterFunc(ctx, func() { _ = file.Close() })
	defer stopAbort()
	if !os.SameFile(before, identity) || !before.ModTime().Equal(identity.ModTime()) {
		return result, ImageHistoryIOError{Code: "OBJECT_CHANGED"}
	}
	if err := localImageNoPending(root, stageName); err != nil {
		return result, err
	}
	result, err = readImageHistoryContent(ctx, file, length, expected, keepData)
	if err != nil {
		return result, err
	}
	after, statErr := file.Stat()
	pathAfter, pathErr := root.Lstat(objectName)
	if statErr != nil || pathErr != nil || !after.Mode().IsRegular() || !pathAfter.Mode().IsRegular() ||
		pathAfter.Mode()&os.ModeSymlink != 0 || !os.SameFile(identity, after) || !os.SameFile(identity, pathAfter) ||
		after.Size() != length || pathAfter.Size() != length || !identity.ModTime().Equal(after.ModTime()) || !identity.ModTime().Equal(pathAfter.ModTime()) {
		result.ReadResult = "UNVERIFIED"
		return result, ImageHistoryIOError{Code: "OBJECT_CHANGED"}
	}
	if err := store.local.verifyMarker(ctx, root); err != nil {
		result.ReadResult = "UNVERIFIED"
		return result, err
	}
	if err := localImageNoPending(root, stageName); err != nil {
		result.ReadResult = "UNVERIFIED"
		return result, err
	}
	if err := localImageAborted(ctx); err != nil {
		result.ReadResult = "UNVERIFIED"
		return result, err
	}
	result.VersionEvidence, result.LocalFinalImmutable = "UNVERSIONED", true
	result.LastModified = identity.ModTime().UTC().Format(time.RFC3339Nano)
	// This proof records a positive immutable publication. It is never derived
	// from age/missing and never authorizes removal of a surviving staging file.
	result.WriterProofSHA256 = imageHistoryProof("LOCAL_FINAL_NO_STAGE_V1", store.location.ID, key, strconv.FormatInt(length, 10), result.SHA256, result.LastModified)
	return result, nil
}

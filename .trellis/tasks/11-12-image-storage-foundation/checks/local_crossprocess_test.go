package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"runtime"
	"testing"
)

func TestLocalCrossProcess(t *testing.T) {
	if runtime.GOOS != "linux" || os.Getuid() != 0 {
		t.Fatal("This proof requires the real Linux service UID")
	}
	ctx := context.Background()
	store, err := NewLocalImageStore(LocalImageStoreConfig{RootDirectory: "/proof/images", VolumeID: "3059f1f1-4e28-4f13-bbfa-6e60c62b1f26"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Verify(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ProbeWritable(ctx); err != nil {
		t.Fatal(err)
	}
	data := []byte("narra-image-shared-volume-proof\n")
	digest := sha256.Sum256(data)
	nodeObject := LocalImageObject{Key: "proof/node.png", ByteLength: int64(len(data)), SHA256: hex.EncodeToString(digest[:])}
	goObject := nodeObject
	goObject.Key = "proof/go.png"
	switch os.Getenv("NARRA_LOCAL_IO_PHASE") {
	case "read-node-write-go":
		read, readErr := store.Read(ctx, nodeObject)
		if readErr != nil || !bytes.Equal(read, data) {
			t.Fatalf("Go could not read the Node-published bytes: %v", readErr)
		}
		if _, err := store.Put(ctx, LocalImagePutInput{LocalImageObject: goObject, Bytes: data}); err != nil {
			t.Fatal(err)
		}
	case "delete-node":
		if result, err := store.Delete(ctx, goObject); err != nil || result != LocalImageMissing {
			t.Fatalf("Node deletion not visible to Go: %s %v", result, err)
		}
		if result, err := store.Delete(ctx, nodeObject); err != nil || result != LocalImageDeleted {
			t.Fatalf("Go could not delete Node-published file: %s %v", result, err)
		}
	default:
		t.Fatal("Unknown fixed cross-process proof phase")
	}
}

package common

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSetProjectUsesIDForUUIDLikeValues(t *testing.T) {
	client := NewClient(&Config{})

	client.SetProject("12345678-1234-1234-1234-123456789012")

	if got := client.GetProjectID(); got != "12345678-1234-1234-1234-123456789012" {
		t.Fatalf("expected project ID to be set, got %q", got)
	}
	if got := client.GetProjectSlug(); got != "" {
		t.Fatalf("expected project slug to be cleared, got %q", got)
	}
}

func TestSetProjectUsesSlugForShortNames(t *testing.T) {
	client := NewClient(&Config{})

	client.SetProject("aya-workspace")

	if got := client.GetProjectSlug(); got != "aya-workspace" {
		t.Fatalf("expected project slug to be set, got %q", got)
	}
	if got := client.GetProjectID(); got != "" {
		t.Fatalf("expected project ID to be cleared, got %q", got)
	}
}

func TestExecuteQuerySetsBlueHeadersAndProjectContext(t *testing.T) {
	var capturedHeaders http.Header

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"ok": true,
			},
		})
	}))
	defer server.Close()

	client := NewClient(&Config{
		APIUrl:    server.URL,
		AuthToken: "secret-token",
		ClientID:  "client-id",
		CompanyID: "company-id",
	})
	client.SetProjectSlug("aya-workspace")

	data, err := client.ExecuteQuery("query Test { ok }", map[string]interface{}{"x": "y"})
	if err != nil {
		t.Fatalf("expected query to succeed, got error: %v", err)
	}
	if ok, _ := data["ok"].(bool); !ok {
		t.Fatalf("expected response data to contain ok=true, got %#v", data)
	}

	if got := capturedHeaders.Get("X-Bloo-Token-ID"); got != "client-id" {
		t.Fatalf("expected token id header, got %q", got)
	}
	if got := capturedHeaders.Get("X-Bloo-Token-Secret"); got != "secret-token" {
		t.Fatalf("expected token secret header, got %q", got)
	}
	if got := capturedHeaders.Get("X-Bloo-Company-ID"); got != "company-id" {
		t.Fatalf("expected company id header, got %q", got)
	}
	if got := capturedHeaders.Get("X-Bloo-Project-Id"); got != "aya-workspace" {
		t.Fatalf("expected project context header, got %q", got)
	}
}

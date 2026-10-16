#!/usr/bin/env bash
# Deploy the agent to Cloud Run on the existing Firebase project. Idempotent: every step can be re-run.
# The agent reads bills with Gemini on Vertex AI (the Cloud Run service account, no key). GOOGLE_API_KEY stays
# attached only as a fallback if GOOGLE_GENAI_USE_VERTEXAI is turned off.
#
#   infra/deploy.sh setup     # billing check, APIs, Firestore, bucket, service account, rules
#   infra/deploy.sh secrets   # copy GOOGLE_API_KEY / GOOGLE_MAPS_API_KEY from .env into Secret Manager (run it yourself)
#   infra/deploy.sh agent     # build with Cloud Build and deploy to Cloud Run; prints the URL
#   infra/deploy.sh cors URL...  # allow these web origins on the agent (all of them, in one call)
#
# Needs: gcloud (gcloud auth login) and firebase (firebase login).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/share/google-cloud-sdk/bin:$PATH"

PROJECT="${PROJECT:-fir-testing-f96b1}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-supplier-carbon-agent}"
BUCKET="${BUCKET:-$PROJECT-bills}"
REPO="${REPO:-supplier-carbon}"
SA_NAME="supplier-carbon-agent"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/agent:$(date +%Y%m%d-%H%M%S)"

say() { printf '\n==> %s\n' "$*"; }

cmd_setup() {
  gcloud config set project "$PROJECT" >/dev/null
  say "billing"
  if [ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)')" != "True" ]; then
    gcloud billing accounts list
    echo "Billing is not linked. Link the trial account:  gcloud billing projects link $PROJECT --billing-account=ACCOUNT_ID" >&2
    exit 1
  fi
  say "APIs"
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    secretmanager.googleapis.com firestore.googleapis.com storage.googleapis.com iamcredentials.googleapis.com \
    identitytoolkit.googleapis.com firebaserules.googleapis.com firebaseapphosting.googleapis.com aiplatform.googleapis.com
  # The server Maps key ("Carbon Count API") lives in this project, restricted to exactly these three APIs:
  # Geocoding and Solar (roof lookup) and Places API (New) (address suggestions). They must be enabled where
  # the key was created; set MAPS_PROJECT if it ever moves to another project.
  gcloud services enable solar.googleapis.com geocoding-backend.googleapis.com places.googleapis.com \
    --project "${MAPS_PROJECT:-$PROJECT}"
  say "Firestore ($REGION)"
  gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 \
    || gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native
  say "bucket gs://$BUCKET"
  gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 \
    || gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
  say "Artifact Registry $REPO"
  gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 \
    || gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"
  say "service account $SA"
  gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$SA_NAME" --display-name="Supplier Carbon agent"
  # roles/aiplatform.user lets the agent call Gemini on Vertex AI with its own identity: no API key, no free-tier cap.
  for role in roles/datastore.user roles/storage.objectAdmin roles/secretmanager.secretAccessor roles/aiplatform.user; do
    gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None >/dev/null
  done
  # Lets the agent sign download URLs for bill images without a key file.
  gcloud iam service-accounts add-iam-policy-binding "$SA" \
    --member="serviceAccount:$SA" --role=roles/iam.serviceAccountTokenCreator >/dev/null
  say "Firestore and Storage rules"
  (cd "$ROOT" && firebase deploy --only firestore:rules,firestore:indexes --project "$PROJECT")
}

# Reads the keys from .env and pipes them straight into Secret Manager. Nothing is printed.
cmd_secrets() {
  gcloud config set project "$PROJECT" >/dev/null
  for pair in GOOGLE_API_KEY:google-api-key GOOGLE_MAPS_API_KEY:google-maps-api-key; do
    var="${pair%%:*}"; name="${pair##*:}"
    val="$(grep -h "^$var=" "$ROOT/.env" "$ROOT/agent/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'" || true)"
    if [ -z "$val" ]; then echo "skip $var: not set in .env" >&2; continue; fi
    gcloud secrets describe "$name" >/dev/null 2>&1 || gcloud secrets create "$name" --replication-policy=automatic
    printf '%s' "$val" | gcloud secrets versions add "$name" --data-file=- >/dev/null
    echo "stored $var as secret $name"
  done
}

cmd_agent() {
  gcloud config set project "$PROJECT" >/dev/null
  say "build $IMAGE"
  (cd "$ROOT" && gcloud builds submit --config infra/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE" .)
  say "deploy $SERVICE"
  gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$SA" \
    --allow-unauthenticated --min-instances 0 --max-instances 2 --memory 1Gi --cpu 1 --timeout 300 \
    --set-env-vars "FIREBASE_PROJECT_ID=$PROJECT,STORAGE_BUCKET=$BUCKET,CORS_ORIGINS=${CORS_ORIGINS:-http://localhost:3000},GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=${VERTEX_LOCATION:-global},GEMINI_RPM=${GEMINI_RPM:-120},GEMINI_RPD=${GEMINI_RPD:-5000}" \
    --set-secrets "GOOGLE_API_KEY=google-api-key:latest,GOOGLE_MAPS_API_KEY=google-maps-api-key:latest"
  gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
}

cmd_cors() {
  gcloud config set project "$PROJECT" >/dev/null
  [ "$#" -ge 1 ] || { echo "usage: deploy.sh cors https://origin [https://origin ...]" >&2; exit 1; }
  # Every web origin that may call the agent, plus localhost. List all of them: this replaces the setting.
  origins="http://localhost:3000"
  for o in "$@"; do origins="$origins,${o%/}"; done
  gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "^@^CORS_ORIGINS=$origins"
}

case "${1:-}" in
  setup) cmd_setup ;;
  secrets) cmd_secrets ;;
  agent) cmd_agent ;;
  cors) shift; cmd_cors "$@" ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac

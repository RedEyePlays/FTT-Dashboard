// Where the public repairStatusLookup Cloud Function lives. This page is a
// standalone bundle deployed to its own Firebase Hosting site (e.g.
// status.flipthat.tech) — it does not share a build, a Firebase client SDK
// instance, or any code with the main app. A Cloud Function is reachable from
// any origin (Firebase's onCall functions allow cross-origin calls by
// default), so hardcoding the function's project/region here is all that's
// needed to reach it — no shared config, no shared init.
export const FUNCTIONS_BASE_URL = 'https://us-central1-ftt-dashboardgit-0945496-a85e0.cloudfunctions.net';
export const LOOKUP_FUNCTION_NAME = 'repairStatusLookup';
// The public PC-build listing lookup, reached at /build/<token>. Same project,
// same region, same reasoning as above.
export const BUILD_LOOKUP_FUNCTION_NAME = 'buildShareLookup';
// The counter kiosk's listing, reached at /showroom/<token>.
export const SHOWROOM_FUNCTION_NAME = 'showroomLookup';

# Render backend deployment

Commit package.json, package-lock.json and application source. Never commit node_modules;
Render must install Linux dependencies from the lockfile.

For the existing Render web service, configure:

- Root Directory: the directory containing this backend package.json (leave blank if the backend is the repository root).
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`

After pushing the removal of tracked node_modules and these source changes, choose
**Manual Deploy > Clear build cache & deploy** once in the Render dashboard.
The build prints a successful Mongoose/MongoDB dependency check before deployment.
Keep the service's existing environment variables configured in Render; do not commit .env.

`Cannot find module '../resource_management'` from mongodb/lib/cursor/abstract_cursor.js
means the installed MongoDB package is incomplete or mixed. Do not create a stub file
or install a package called resource_management. A clean `npm ci` reinstalls the
complete driver selected by package-lock.json.

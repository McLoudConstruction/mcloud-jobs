# Nav update - deploy steps
1. Copy every file in this zip over the same path in the repo (JobJumpSearch.js and JobSidebar.js are new if you did not push the earlier zip).
2. DELETE the folder app/portal (old customer portal; /portal and /portal/dashboard now redirect to /customerportal via next.config.js).
3. No migration, no new env vars. Commit and push.
Old links to Sell > Plans (?tab=Sell&section=floorplan) open the new Sketch tab.

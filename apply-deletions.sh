#!/bin/sh
# Run from the repo root before pushing. Removes the files listed in DELETE-THESE-FILES.txt.
while IFS= read -r f; do [ -n "$f" ] && rm -f -- "$f"; done < DELETE-THESE-FILES.txt
# Remove folders left empty by the deletions.
rmdir components/components components/lib app/lib/integrations app/lib app/sales/outreach app/api/sales/outreach/test app/api/sales/outreach app/api/sales app/api/capture/classify-specs app/api/capture 2>/dev/null
echo "Done. $(wc -l < DELETE-THESE-FILES.txt | tr -d " ") files removed."

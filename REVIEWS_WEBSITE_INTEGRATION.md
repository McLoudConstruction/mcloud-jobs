# Showing McLoud reviews on the marketing site

Reviews are collected privately in McLoud Jobs. Nothing is public until you
publish it on the **Projects → Reviews** page AND the customer ticked "you may
share my comments publicly".

## The feed

`GET https://jobs.mcloudconstruction.com/api/public/reviews?limit=12`

CORS allows only `https://www.mcloudconstruction.com` and
`https://mcloudconstruction.com`. Responses are cached for 5 minutes.

```json
{
  "count": 27,
  "average": 4.81,
  "reviews": [
    { "name": "Jane S.", "project": "Kitchen remodel", "rating": 5,
      "comment": "…", "categories": { "quality": 5 }, "date": "2026-09-30T…", "featured": true }
  ]
}
```

`count` and `average` cover **every** review received, published or not. That is
deliberate: the site can't show a rosier picture than reality, which keeps you
on the right side of the FTC's rules on review suppression. Featured reviews
come first, then newest.

## Example component (Next.js / React)

```jsx
'use client';
import { useEffect, useState } from 'react';

export default function Reviews() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch('https://jobs.mcloudconstruction.com/api/public/reviews?limit=6')
      .then(r => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, []);
  if (!data || !data.reviews.length) return null;
  return (
    <section>
      <h2>{data.average} ★ from {data.count} customers</h2>
      {data.reviews.map((r, i) => (
        <blockquote key={i}>
          <div aria-label={`${r.rating} stars`}>{'★'.repeat(r.rating)}</div>
          <p>{r.comment}</p>
          <footer>{r.name}{r.project ? ` · ${r.project}` : ''}</footer>
        </blockquote>
      ))}
      <p><small>Selected customer reviews. Rating reflects all reviews received.</small></p>
    </section>
  );
}
```

For a static site, fetch it at build time or on the server instead, and
revalidate every few minutes.

## Two things to know

- **Structured data / star snippets.** Google no longer shows star ratings in
  search results for a business reviewing itself (LocalBusiness / Organization
  markup). Adding `aggregateRating` JSON-LD for your own business is against
  their guidelines and won't earn stars. Show the reviews on the page; skip the
  self-serving markup.
- **"Selected" reviews.** Because you choose which reviews to publish, label the
  section as selected reviews and keep the true average/count next to it, as
  above.

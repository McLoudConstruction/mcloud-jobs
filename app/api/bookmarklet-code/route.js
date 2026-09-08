// Serves the minified bookmarklet JS as plain text, so the install page
// can build the javascript: href without embedding a huge inline string
// in the React bundle, and so updating the scraper is a one-file change.

const BOOKMARKLET_CODE = "!function(){var e=\"https://jobs.mcloudconstruction.com/capture\";var r,t=function(){for(var e=document.querySelectorAll('script[type=\"application/ld+json\"]'),r=0;r<e.length;r++)try{for(var t=JSON.parse(e[r].textContent),n=Array.isArray(t)?t:[t],a=0;a<n.length;a++){var o=n[a];if(o[\"@graph\"]&&(o=o[\"@graph\"].find(function(e){return\"Product\"===e[\"@type\"]})||o),o&&(\"Product\"===o[\"@type\"]||Array.isArray(o[\"@type\"])&&-1!==o[\"@type\"].indexOf(\"Product\"))){var l=Array.isArray(o.offers)?o.offers[0]:o.offers,u=Array.isArray(o.image)?o.image[0]:o.image;return{name:o.name||null,brand:o.brand&&(o.brand.name||o.brand)||null,sku:o.sku||o.mpn||null,imageUrl:u||null,priceCents:l&&l.price?Math.round(100*parseFloat(l.price)):null}}}}catch(e){}return null}()||function(){function e(e){var r=document.querySelector('meta[property=\"'+e+'\"], meta[name=\"'+e+'\"]');return r?r.getAttribute(\"content\"):null}var r=e(\"og:title\");if(!r)return null;var t=e(\"product:price:amount\")||e(\"og:price:amount\");return{name:r,brand:e(\"product:brand\")||e(\"og:brand\")||null,sku:null,imageUrl:e(\"og:image\"),priceCents:t?Math.round(100*parseFloat(t)):null}}()||{name:(r=document.querySelector(\"h1\"))?r.textContent.trim():document.title,brand:null,sku:null,imageUrl:null,priceCents:null};t.sourceUrl=window.location.href;var n=window.open(e,\"mcloudCapture\",\"width=460,height=640\");n?window.addEventListener(\"message\",function r(a){a.source===n&&a.data&&\"MCLOUD_CAPTURE_READY\"===a.data.type&&(n.postMessage({type:\"MCLOUD_CAPTURE\",payload:t},e),window.removeEventListener(\"message\",r))}):alert(\"McLoud Jobs: please allow popups for this site, then click the bookmarklet again.\")}();";

export async function GET() {
  return new Response(BOOKMARKLET_CODE, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

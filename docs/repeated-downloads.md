# Repeated handoff downloads

Handoff and batch detail pages now declare their JSON and CSV anchors as native downloads. This keeps the detail page available for subsequent downloads instead of initiating a document navigation to an attachment endpoint. The server continues to supply the filename and file contents.

The change covers purchase, transfer and event purchase handoffs and their three batch screens. Export routes, authentication, organization filters, row-level security, serializers and response headers are unchanged. No migration or data update is required.

Each existing end-to-end handoff/batch scenario now downloads JSON, CSV, JSON and CSV from the same page, using mouse and keyboard activation. It checks successful completion, filenames, exact bytes and the unchanged detail URL after every download. No reload, new tab, mocked response or request interception is used.

The connected Chrome session reproduced an attachment-navigation error with ordinary links on a standalone local server. Explicit download links allowed both requests and retained the page. The browser-control download-capture helper also timed out after its first captured file, including on the standalone page; that separate limitation is not a claim that hosted end-to-end verification passed. Hosted verification must confirm the deployed links and actual consecutive files.

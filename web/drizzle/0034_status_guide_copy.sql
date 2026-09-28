-- Rewrites the text the board's column info panel shows: each status's description, next step and
-- automation note, and each transition rule's trigger note. The seeded text described steps that no
-- longer happen ("Auto-transitioned when assignment email is sent"), and the board now shows it to
-- everyone through the "i" next to each column name.
--
-- Each UPDATE only replaces text that still matches the original seed, so anything an admin has
-- changed in Settings stays as it is, and running this twice changes nothing the second time.

UPDATE "statuses" SET "description" = 'New asset, waiting for an artist.' WHERE "key" = 'unassigned' AND "description" IS NOT DISTINCT FROM 'New SKU created, awaiting artist assignment';
UPDATE "statuses" SET "next_action_hint" = 'Drag the card to Assigned, or open it and use Assign artist. The artist gets an offer by email and Discord.' WHERE "key" = 'unassigned' AND "next_action_hint" IS NOT DISTINCT FROM 'Assign an artist to this SKU';
UPDATE "statuses" SET "automation_note" = 'New assets start here. An asset comes back here when its artist declines the offer.' WHERE "key" = 'unassigned' AND "automation_note" IS NOT DISTINCT FROM 'Auto-transitioned when a SKU is created';
UPDATE "statuses" SET "description" = 'An artist has been offered this asset.' WHERE "key" = 'assigned' AND "description" IS NOT DISTINCT FROM 'Artist assigned and assignment notification sent';
UPDATE "statuses" SET "next_action_hint" = 'The artist accepts, asks for up to 3 more days, or declines on My Tasks. Once they accept, they move it to In Production.' WHERE "key" = 'assigned' AND "next_action_hint" IS NOT DISTINCT FROM 'Artist accepts assignment and begins WIP';
UPDATE "statuses" SET "automation_note" = 'Moves here when someone picks an artist. Goes back to Unassigned if the artist declines.' WHERE "key" = 'assigned' AND "automation_note" IS NOT DISTINCT FROM 'Auto-transitioned when assignment email is sent';
UPDATE "statuses" SET "description" = 'The artist is making the asset.' WHERE "key" = 'in_progress' AND "description" IS NOT DISTINCT FROM 'Artist is actively working on the asset';
UPDATE "statuses" SET "next_action_hint" = 'The artist moves it to In Review when a draft is ready.' WHERE "key" = 'in_progress' AND "next_action_hint" IS NOT DISTINCT FROM 'Submit WIP or final draft for review';
UPDATE "statuses" SET "automation_note" = NULL WHERE "key" = 'in_progress' AND "automation_note" IS NOT DISTINCT FROM 'Manual move by artist or operator';
UPDATE "statuses" SET "description" = 'The team is reviewing the artist''s draft.' WHERE "key" = 'in_review' AND "description" IS NOT DISTINCT FROM 'Asset submitted and undergoing operator review';
UPDATE "statuses" SET "next_action_hint" = 'The team moves it to Approved, or to Revisions Requested with feedback for the artist.' WHERE "key" = 'in_review' AND "next_action_hint" IS NOT DISTINCT FROM 'Approve asset or request revisions';
UPDATE "statuses" SET "automation_note" = NULL WHERE "key" = 'in_review' AND "automation_note" IS NOT DISTINCT FROM 'Manual move by artist on submission';
UPDATE "statuses" SET "description" = 'The team asked the artist for changes.' WHERE "key" = 'revisions_requested' AND "description" IS NOT DISTINCT FROM 'Operator requested revisions on submitted asset';
UPDATE "statuses" SET "next_action_hint" = 'The artist moves it back to In Production while making the changes.' WHERE "key" = 'revisions_requested' AND "next_action_hint" IS NOT DISTINCT FROM 'Artist updates WIP per feedback';
UPDATE "statuses" SET "automation_note" = NULL WHERE "key" = 'revisions_requested' AND "automation_note" IS NOT DISTINCT FROM 'Manual move by operator';
UPDATE "statuses" SET "description" = 'The team approved the design.' WHERE "key" = 'approved' AND "description" IS NOT DISTINCT FROM 'Asset design approved by operator';
UPDATE "statuses" SET "next_action_hint" = 'The artist uploads the final files on the asset''s card. The card then moves to Ready for Upload on its own.' WHERE "key" = 'approved' AND "next_action_hint" IS NOT DISTINCT FROM 'Submit final files link';
UPDATE "statuses" SET "automation_note" = 'Uploading the final files moves the card on.' WHERE "key" = 'approved' AND "automation_note" IS NOT DISTINCT FROM 'Manual move by operator';
UPDATE "statuses" SET "description" = 'The final files are in Drive.' WHERE "key" = 'final_files_received' AND "description" IS NOT DISTINCT FROM 'Final uncompressed production files submitted';
UPDATE "statuses" SET "next_action_hint" = 'Passes straight on to Ready for Upload. A card only stays here if telling the uploader failed.' WHERE "key" = 'final_files_received' AND "next_action_hint" IS NOT DISTINCT FROM 'Notify Roblox Publisher for upload';
UPDATE "statuses" SET "automation_note" = 'Moves here when the final files are uploaded, and on to Ready for Upload straight away.' WHERE "key" = 'final_files_received' AND "automation_note" IS NOT DISTINCT FROM 'Auto-transitioned on valid final-file submission';
UPDATE "statuses" SET "description" = 'The final files are ready for the uploader.' WHERE "key" = 'ready_for_upload' AND "description" IS NOT DISTINCT FROM 'Roblox Publisher notified and asset ready for Roblox';
UPDATE "statuses" SET "next_action_hint" = 'The uploader uploads it to Roblox and adds the catalog links on the Upload queue page. The card then moves to Uploaded to Roblox on its own.' WHERE "key" = 'ready_for_upload' AND "next_action_hint" IS NOT DISTINCT FROM 'Upload to Roblox and submit marketplace links';
UPDATE "statuses" SET "automation_note" = 'Adding the Roblox links moves the card on.' WHERE "key" = 'ready_for_upload' AND "automation_note" IS NOT DISTINCT FROM 'Auto-transitioned when publisher is notified';
UPDATE "statuses" SET "description" = 'The asset is live on the Roblox marketplace.' WHERE "key" = 'uploaded_to_roblox' AND "description" IS NOT DISTINCT FROM 'Asset live on Roblox marketplace, link verified';
UPDATE "statuses" SET "next_action_hint" = 'The payment admin, or someone allowed to mark payments, moves it to Marked for Payment.' WHERE "key" = 'uploaded_to_roblox' AND "next_action_hint" IS NOT DISTINCT FROM 'Mark for artist payment';
UPDATE "statuses" SET "automation_note" = 'Moves here when the uploader adds the Roblox links.' WHERE "key" = 'uploaded_to_roblox' AND "automation_note" IS NOT DISTINCT FROM 'Auto-transitioned on valid Roblox link submission';
UPDATE "statuses" SET "description" = 'The artist''s payment is approved and waiting to be paid.' WHERE "key" = 'marked_for_payment' AND "description" IS NOT DISTINCT FROM 'Payment approved, pending payout execution';
UPDATE "statuses" SET "next_action_hint" = 'The payment admin pays the artist, attaches the receipt on the Payments page, then moves it to Payment Done.' WHERE "key" = 'marked_for_payment' AND "next_action_hint" IS NOT DISTINCT FROM 'Execute payment to artist';
UPDATE "statuses" SET "automation_note" = 'Only reachable from Uploaded to Roblox, for everyone including admins.' WHERE "key" = 'marked_for_payment' AND "automation_note" IS NOT DISTINCT FROM 'Strictly gated: reachable ONLY from Uploaded to Roblox';
UPDATE "statuses" SET "description" = 'The artist has been paid. This is the last step.' WHERE "key" = 'payment_done' AND "description" IS NOT DISTINCT FROM 'Artist payout complete, SKU cycle finished';
UPDATE "statuses" SET "next_action_hint" = NULL WHERE "key" = 'payment_done' AND "next_action_hint" IS NOT DISTINCT FROM 'SKU cycle complete';
UPDATE "statuses" SET "automation_note" = 'Needs the payment receipt attached first, for everyone including admins.' WHERE "key" = 'payment_done' AND "automation_note" IS NOT DISTINCT FROM 'Manual move by Payment Admin';

UPDATE "status_transition_rules" SET "trigger_note" = 'The artist starts work, after accepting the offer.' WHERE "from_status" = 'assigned' AND "to_status" = 'in_progress' AND "trigger_note" IS NOT DISTINCT FROM 'Artist begins work';
UPDATE "status_transition_rules" SET "trigger_note" = 'The artist submits a draft for review.' WHERE "from_status" = 'in_progress' AND "to_status" = 'in_review' AND "trigger_note" IS NOT DISTINCT FROM 'Artist submits draft';
UPDATE "status_transition_rules" SET "trigger_note" = 'The team asks the artist for changes.' WHERE "from_status" = 'in_review' AND "to_status" = 'revisions_requested' AND "trigger_note" IS NOT DISTINCT FROM 'Operator requests revisions';
UPDATE "status_transition_rules" SET "trigger_note" = 'The artist starts on the changes.' WHERE "from_status" = 'revisions_requested' AND "to_status" = 'in_progress' AND "trigger_note" IS NOT DISTINCT FROM 'Artist updates work';
UPDATE "status_transition_rules" SET "trigger_note" = 'The team approves the draft.' WHERE "from_status" = 'in_review' AND "to_status" = 'approved' AND "trigger_note" IS NOT DISTINCT FROM 'Operator approves asset';
UPDATE "status_transition_rules" SET "trigger_note" = 'The payment admin, or someone allowed to mark payments, marks it for payment.' WHERE "from_status" = 'uploaded_to_roblox' AND "to_status" = 'marked_for_payment' AND "trigger_note" IS NOT DISTINCT FROM 'Payment admin marks paid (Gated: only from uploaded_to_roblox)';
UPDATE "status_transition_rules" SET "trigger_note" = 'The payment admin pays the artist and attaches the receipt.' WHERE "from_status" = 'marked_for_payment' AND "to_status" = 'payment_done' AND "trigger_note" IS NOT DISTINCT FROM 'Payment admin finishes payout';
UPDATE "status_transition_rules" SET "trigger_note" = 'Moves when someone picks an artist, which sends them the offer.' WHERE "from_status" = 'unassigned' AND "to_status" = 'assigned' AND "trigger_note" IS NOT DISTINCT FROM 'Triggered on assignment email sent';
UPDATE "status_transition_rules" SET "trigger_note" = 'Moves when the artist uploads the final files.' WHERE "from_status" = 'approved' AND "to_status" = 'final_files_received' AND "trigger_note" IS NOT DISTINCT FROM 'Triggered on valid final-file submission';
UPDATE "status_transition_rules" SET "trigger_note" = 'Moves straight on once the uploader is told the files are in.' WHERE "from_status" = 'final_files_received' AND "to_status" = 'ready_for_upload' AND "trigger_note" IS NOT DISTINCT FROM 'Triggered when publisher notified';
UPDATE "status_transition_rules" SET "trigger_note" = 'Moves when the uploader adds the Roblox links.' WHERE "from_status" = 'ready_for_upload' AND "to_status" = 'uploaded_to_roblox' AND "trigger_note" IS NOT DISTINCT FROM 'Triggered on valid Roblox link submission';

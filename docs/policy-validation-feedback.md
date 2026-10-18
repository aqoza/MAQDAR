# Policy validation feedback

An inverted proposal (reorder 500, maximum 400) was correctly rejected, but the form only said to check highlighted fields without identifying any. Policy submission and decision actions now preserve translated field errors. Invalid controls have a visible error border and an accessible description; labels stay stable and submitted values are retained.

The maximum-order comparison identifies the maximum field. Quantity format errors explain the existing nonnegative, 15-whole-digit / 3-decimal limit. No numeric rule, organization guard, role check, RPC or database policy changes.

Regression checks cover invalid proposals and blank reasons without database writes, then correction, submission and an independent approval in the existing local browser workflow. The browser check verifies the error description, invalid attribute and retained input values before correction.

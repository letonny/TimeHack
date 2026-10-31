# TimeHack 4.6 metric definitions

The Home and Insights **Tracked activity** metric is recorded activity time plus recorded breaks and duration-only entries. It excludes travel and paused gaps. Earlier Home/Insights labels said “Tracked time”; for Trip Mode those views could include travel. The new label and calculation make the distinction explicit.

**Productive time** is recorded active time from sessions whose saved `counts_productive` snapshot is true. **Leisure / personal time** is recorded active time from sessions whose snapshot is false. Category is an optional organizational label and does not control either total.

**Travel time** comprises Trip Mode outbound and return intervals, shown separately and included in full session commitment. **Paused time** is excluded from recorded activity, breaks, and travel, but is included in elapsed commitment between a session’s outer boundaries.

Nested SETs are detail within parent activity intervals and are never added to parent totals. Overlapping clock intervals across sessions are allocated once in day and period analytics. Duration-only entries have no clock position and are added on their saved local date.

Habit progress uses recorded active time for the linked activity regardless of productivity classification. It excludes breaks, travel, and pauses.

Existing sessions and activities default to productive in the additive migration. Changing an activity default affects future sessions only. Reclassifying a historical session is an explicit edit from History. Completed timer interval corrections require an online, fully synchronized account and use the dedicated audited RPC; metadata edits and classification continue through the offline queue.

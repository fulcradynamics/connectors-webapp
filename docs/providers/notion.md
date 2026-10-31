# Set up Notion → Fulcra

This connector makes **one-way copies from Notion into your Fulcra account**. Changes in Fulcra do not update Notion. It imports selected page documents and their accessible nested blocks. It does not automatically expand databases into rows or add future entries; select individual page entries from discovery. Comments are not imported.

## 1. Create or open your Notion connection

1. Open the [Notion connection console](https://app.notion.com/developers/connections) while signed into the workspace you want to import.
2. Under **Build → Internal connections**, choose **Create a new connection**, enter a name and select the workspace. You must be a workspace owner. If you already created an internal connection, open it instead.
3. In **Configuration → Capabilities**, turn **Read content** on. Turn **Update content**, **Insert content**, comment access and agent access off. Choose **No user information**. This app needs no Notion write permission.

## 2. Give it access to content

1. Open **Content access → Edit access** in that connection.
2. Select the pages or databases you intend to import and choose **Save**. Sharing a parent includes its children. Check that the saved access list contains your selection.
3. Alternatively, open a page in Notion, choose **••• → Connections → Add connection**, select the internal connection and confirm access to that page and its children.

**A new connection has no content access by default. A verified token alone does not grant any page access.** Notion search can take time to index a new grant.

## 3. Verify the token in your own connector app

1. Return to Notion **Configuration** and copy the **API token**. Keep it secret; never paste it in chat, source code or a Notion page.
2. Open your personal Fulcra connector deployment's `/app`. Ensure **Background access ready for all connectors** is shown; approve background access if needed. Browser sign-in and background authorization are separate.
3. Choose **Notion**, enter a connection name and paste the token into **Internal connection API token**. Choose **Verify and continue →**. Verification checks the connection identity and does not start collection.

## 4. Select pages and an output

1. In **Sources**, choose **Discover available root pages**. Check the page documents you want. Search can return individual database entries and descendants; sharing a database does not automatically select them. Each selected page includes its accessible nested blocks.
2. Select up to **50 sources per connection**. Use **Load more sources** when shown. If nothing appears, check the saved Notion content access, workspace and connection; allow indexing to catch up, then choose **Refresh sources**.
3. Choose **Continue to destination**. The proposed output is **Files in a folder → `/connectors/notion`**. You can change the path, choose a connector-compatible **v1 Event** data type, or use both. These are destinations in your own Fulcra account.
4. Choose **Continue to schedule**. The proposed interval is **300 seconds (5 minutes)**, configurable from 60 seconds to 24 hours for this connection. The starting date does not filter Notion: each selected page and its nested blocks are scanned completely. Pagination, throttling and retries can delay updates.

## 5. Preview, enable and verify

1. Choose **Save and preview output**. Inspect the sample content and destination. Preview reads Notion but performs no import writes.
2. Confirm the preview and choose **Enable** to start collection. A configuration change requires a fresh preview before enabling again.
3. Check the connection's **Last attempt**, **Last verified sync** and any error. In Fulcra, open the chosen folder or v1 type and verify the imported document. An upload receipt alone is not verified delivery.
4. Use **Pause** to stop future collection, **Retry queued work** after resolving a reported failure, or **Disconnect** to remove the stored credential. Existing imports remain. Revoke the token separately in Notion if needed.

## Troubleshooting

- **Token verifies, picker empty:** Check **Content access → Edit access → select → Save** in the same workspace and internal connection that issued the token. Wait for Notion search indexing, then **Refresh sources**. Recreating a token does not grant page access.
- **Invalid or revoked token:** Copy the current internal connection token into **Replace credential** in your protected app. Replacement pauses collection; preview and enable again.
- **Page inaccessible after selection:** Check its parent/child grant and any removed access. The connector retains access-loss status rather than deleting existing Fulcra copies.
- **Traversal too large or preview incomplete:** Choose smaller pages. A root is bounded to 5,000 blocks and 2 MB of traversal state. A bounded preview can end before a large page is complete.
- **New database entry missing:** Refresh discovery and explicitly add the new page entry, then preview and enable the updated selection. Automatic database membership sync is outside this version.

## Supported behavior and verification

The API version is pinned to `2026-03-11`. Search supplies the picker only. Collection retrieves page properties and follows children using persisted pagination and a breadth-first frontier. A complete document is emitted once that frontier is empty. Markdown renders supported text structures and visible unsupported-block markers; external files remain links. Repeated root scans detect changes in older nested blocks. Imported revision IDs include canonical content, and old revisions remain in Fulcra.

Fixtures verify nested/paginated traversal, version headers, unsupported-block visibility, complete-document gating, selected-root boundaries and access loss. Live-account results must be verified separately; fixtures do not prove a particular owner's import.

Notion's API supports content writes, so a separate two-way design is possible. This connector has no write-back path; adding write permissions does not enable one. Two-way sync would need explicit editable fields, ownership, conflict handling and deletion rules.

Official references: [internal connections](https://developers.notion.com/guides/get-started/internal-connections), [search indexing and limitations](https://developers.notion.com/reference/search-optimizations-and-limitations), [block children](https://developers.notion.com/reference/get-block-children), [versioning](https://developers.notion.com/reference/versioning).

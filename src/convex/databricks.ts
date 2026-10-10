"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { checkDatabricksWorkspace } from "./lib/databricks";

/**
 * Check server-configured Databricks access without exposing the token to the
 * client. This performs only a read-only current-user request.
 */
export const checkWorkspace = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");

    return await checkDatabricksWorkspace(
      process.env.DATABRICKS_HOST,
      process.env.DATABRICKS_TOKEN,
    );
  },
});

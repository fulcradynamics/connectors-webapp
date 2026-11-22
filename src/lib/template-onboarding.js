export const accountUrl = 'https://fulcra.ai/product/start-for-free';

export const setupPrompt = `Help me set up my own third-party data connectors on Fulcra. Start with ${accountUrl} and https://docs.fulcradynamics.com/agent-get-started.txt to create or connect my Fulcra account if needed. Check whether this agent can run terminal commands and deploy an app; if it cannot, explain how to continue in a coding agent that can. Read https://connectors.my.fulcra.ai/guides/agent.md and https://connectors.my.fulcra.ai/guides/setup.md and follow their current published checkout instructions for https://github.com/fulcradynamics/connectors-webapp. The connectors.my.fulcra.ai site is a reference template; sign-in and provider setup belong on my own deployed copy. Verify the intended personal or company owner, help me choose an available authorized [name].my.fulcra.ai namespace, and fork or clone and deploy a separate instance with its own credentials and configuration. Inspect any existing checkout or deployment first and preserve its environment, encryption keys, grants and native controller identity. Never copy another instance's private state. Verify the intended domain, exact deployed source, READY state and owner-only controls. Then guide me through the selected provider's required API key, token or OAuth authorization in the protected form on my own site. Keep credentials out of chat and source control. Have me choose sources, destination, history and sync interval; explain the separate background Fulcra authorization, preview and ask before enabling collection or two-way writes. Verify a real imported file or record and its updated source index before claiming sync works. Explain missing API access or permissions rather than promising every service is supported.`;

/** @param {{writeText:(text:string)=>Promise<void>}|undefined} clipboard */
export async function copySetupPrompt(clipboard) {
  try {
    if (!clipboard) return false;
    await clipboard.writeText(setupPrompt);
    return true;
  } catch {
    return false;
  }
}

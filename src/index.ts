import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "cloudflare:workers";

type Env = { GOOGLE_API_KEY?: string; }; 


type ExecutionContext = any;



// Define Models using Zod
export const AddressSchema = z.object({
    name: z.string(),
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    country: z.string().default('US'),
});

export type Address = z.infer<typeof AddressSchema>;

export const AddressValidationResultSchema = z.object({
    is_valid: z.boolean(),
    corrected_address: z.record(z.any()), // Using record(z.any()) for dict
    original_address: z.record(z.any()),
    messages: z.array(z.string()),
});
export type AddressValidationResult = z.infer<typeof AddressValidationResultSchema>;

function getClick2mailBasicAuthHeader(props: Record<string, any> = {}): HeadersInit {
    return {
       "Authorization": `Basic ${env.TOOL_EXECUTION_API_KEY}`,
       "Accept": "application/json"
   };
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
    server = new McpServer({
        name: "Click2mail",
        version: "1.0.0", 
    });

    async init() {
        // Define Tools
        this.server.tool(
            "job_status",
            "Check status of job",
            {	
				jobid: z.string(),	
			},            
            async ({jobid}) => {
                const url = `https://stage-rest.click2mail.com/molpro/jobs/${jobid}`;


                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: getClick2mailBasicAuthHeader(this.props),
                        // timeout: 30000
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const description = data?.description;

                    if (description) {
                        return { content: [{ type: "text", text: description }] };
                    } else {
                        return { content: [{ type: "text", text: "Job description not found in response." }] };
                    }

                } catch (error: any) {
                    console.error("Error getting job status:", error);
                    // Returning null/undefined as in Python example on error
                    return { content: [{ type: "text", text: `Error getting job status: ${error.message}` }] };
                }
            }
        );

        this.server.tool(
            "check_balance",
            z.object({}), // No arguments
            async () => {
                // TODO: Implement check_balance logic here based on Python code
                // This should make an HTTP request to the Click2mail credit endpoint.
                const url = `https://stage-rest.click2mail.com/molpro/credit`;
                const headers = getClick2mailBasicAuthHeader(this.props);

                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: headers,
                        // timeout: 30000
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const balance = data?.balance;

                    if (balance !== undefined) { // Check for undefined as balance could be 0 or null
                         return { content: [{ type: "text", text: `Available balance: ${balance}` }] };
                    } else {
                         return { content: [{ type: "text", text: "Balance information not found in response." }] };
                    }

                } catch (error: any) {
                    console.error("Error checking balance:", error);
                     return { content: [{ type: "text", text: `Error checking balance: ${error.message}` }] };
                }
            }
        );


        this.server.tool(
            "validate_address",
            "Validates an address using the Google Address Validation API.",
            {
				
				address: z.string(),
				city: z.string(),
                state: z.string(),
                zip: z.string()
			},
            
            
            async ({address, city, state, zip}) => {
                // TODO: Implement validate_address logic here based on Python code
                // This should call the Google Address Validation API.
                const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
                 if (!GOOGLE_API_KEY) {
                     return { content: [{ type: "text", text: "Google API Key for address validation is not configured." }] };
                 }

                const url = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${GOOGLE_API_KEY}`;

                const payload = {
                    address: {
                        addressLines: [address], // Address lines should be an array
                        locality: city,
                        postalCode: zip,
                        administrativeArea: state,
                    },
                    enableUspsCass: true // Hardcoded in Python
                };

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`Address validation failed: HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const verdict = data?.result?.verdict;
                    const is_valid = verdict?.hasUnconfirmedComponents === false && verdict?.hasInferredComponents === false;

                    const corrected = data?.result?.address.formattedAddress;
                    const messages = data?.result?.validationMessages?.map((msg: any) => msg.text) || [];
                    return { content: [{ type: "text", text: `Corrected Address: ${corrected}` }] };

                } catch (error: any) {
                     console.error("Error validating address:", error);
                     return { content: [{ type: "text", text: `Error validating address: ${error.message}` }] };
                }
            }
        );
    }
}

// Example serving block (adjust paths as needed)
export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
       

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
        }

        if (url.pathname === "/mcp") {
            const apiKey = request.headers.get('mcp_token');
            console.log(apiKey);
            ctx.props = {
                ...ctx.props, // Preserve any existing props
                toolExecutionApiKey: apiKey, // Use a descriptive, camelCase key
            };
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
}; 

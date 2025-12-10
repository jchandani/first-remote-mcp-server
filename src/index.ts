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


// Define a type for your custom props for type safety
interface CustomProps {
    toolExecutionApiKey?: string;
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env, unknown, CustomProps> {
    getClick2mailBasicAuthHeader(): HeadersInit {
        
        // 🛑 Retrieve the key from the context properties (`this.props`)
        const apiKey = this.props.toolExecutionApiKey;
        
        if (!apiKey) {
            console.error("TOOL_EXECUTION_API_KEY is missing in props.");
            // You should throw an error or handle the missing key
            throw new Error("Authentication Failed 1: Missing tool API key.");
        }
        
        // Use the apiKey to create the Basic Authorization header
        // NOTE: Basic auth requires the value to be base64-encoded, typically "username:password"
        // Ensure you are base64-encoding the value if that's what Click2Mail expects.
        // If your 'mcp_token' is already the full base64 string, use it directly.
        
        return {
           "Authorization": `Basic ${apiKey}`,
           "Accept": "application/json"
        };
    }

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
                        headers: this.getClick2mailBasicAuthHeader(),
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
            "get_documents",
            "Retrieve list of documents from Click2Mail account",
            {
                limit: z.number().optional().describe("Maximum number of documents to return (default: 50, max: 100)"),
                offset: z.number().optional().describe("Number of documents to skip for pagination (default: 0)"),
            },
            async ({ limit, offset }) => {
                // Build query parameters
                const params = new URLSearchParams();
                if (limit !== undefined) {
                    params.append('limit', Math.min(limit, 100).toString());
                }
                if (offset !== undefined) {
                    params.append('offset', offset.toString());
                }
                
                const queryString = params.toString();
                const url = `https://stage-rest.click2mail.com/molpro/documents${queryString ? '?' + queryString : ''}`;
        
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: this.getClick2mailBasicAuthHeader(),
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    // Format the response for better readability
                    if (data && Array.isArray(data)) {
                        const documentList = data.map((doc: any) => ({
                            id: doc.id,
                            name: doc.documentName,
                            status: doc.status,
                            pages: doc.pages,
                            created: doc.createdDate,
                        }));
                        
                        return { 
                            content: [{ 
                                type: "text", 
                                text: `Found ${documentList.length} documents:\n${JSON.stringify(documentList, null, 2)}` 
                            }] 
                        };
                    } else {
                        return { 
                            content: [{ 
                                type: "text", 
                                text: JSON.stringify(data, null, 2) 
                            }] 
                        };
                    }
        
                } catch (error: any) {
                    console.error("Error retrieving documents:", error);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error retrieving documents: ${error.message}` 
                        }] 
                    };
                }
            }
        );

        this.server.tool(
            "get_cost_estimate",
            "Get cost estimate for a mailing job",
            {
                productClass: z.string().describe("Product class (e.g., Letter, Postcard)"),
                layout: z.string().describe("Layout specification"),
                envelope: z.string().describe("Envelope specification"),
                productionTime: z.string().describe("Production time"),
                mailingClass: z.string().describe("Mailing class (e.g., First, Standard)"),
                color: z.boolean().describe("Color printing"),
                doubleSided: z.boolean().describe("Double-sided printing"),
                paperType: z.string().describe("Paper type specification"),
                numberOfPages: z.number().optional().describe("How many pages in your document"),
            },
            async ({ numberOfPages, productClass, layout, envelope, productionTime, mailingClass, color, doubleSided, paperType }) => {
                

                const params = new URLSearchParams();
                params.append('documentClass', productClass);
                params.append('layout', layout);
                params.append('productionTime', productionTime);
                params.append('mailClass', mailingClass);
                params.append('envelope', envelope);
                params.append('color', color);
                params.append('paperType', paperType);
                params.append('printOption', doubleSided);
                if (numberOfPages !== undefined) {
                    params.append('numberOfPages', numberOfPages.toString());
                }
             
                const queryString = params.toString();
                const url = `https://stage-rest.click2mail.com/molpro/costEstimate${queryString ? '?' + queryString : ''}`;

                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            ...this.getClick2mailBasicAuthHeader(),
                            'Content-Type': 'application/json',
                        }
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Cost Estimate:\n${JSON.stringify(data, null, 2)}` 
                        }] 
                    };
        
                } catch (error: any) {
                    console.error("Error getting cost estimate:", error);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error getting cost estimate: ${error.message}` 
                        }] 
                    };
                }
            }
        );

        this.server.tool(
            "get_address_lists",
            "Retrieve address/mailing lists from Click2Mail account",
            {
                limit: z.number().optional().describe("Maximum number of address lists to return (default: 50, max: 100)"),
                offset: z.number().optional().describe("Number of address lists to skip for pagination (default: 0)"),
            },
            async ({ limit, offset }) => {
                // Build query parameters
                const params = new URLSearchParams();
                if (limit !== undefined) {
                    params.append('limit', Math.min(limit, 100).toString());
                }
                if (offset !== undefined) {
                    params.append('offset', offset.toString());
                }
                
                const queryString = params.toString();
                const url = `https://stage-rest.click2mail.com/molpro/addressLists${queryString ? '?' + queryString : ''}`;
        
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: this.getClick2mailBasicAuthHeader(),
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    // Format the response for better readability
                    if (data && Array.isArray(data)) {
                        const addressLists = data.map((list: any) => ({
                            id: list.id,
                            name: list.addressListName,
                            addressCount: list.addressCount,
                            created: list.createdDate,
                            modified: list.modifiedDate,
                        }));
                        
                        return { 
                            content: [{ 
                                type: "text", 
                                text: `Found ${addressLists.length} address lists:\n${JSON.stringify(addressLists, null, 2)}` 
                            }] 
                        };
                    } else {
                        return { 
                            content: [{ 
                                type: "text", 
                                text: JSON.stringify(data, null, 2) 
                            }] 
                        };
                    }
        
                } catch (error: any) {
                    console.error("Error retrieving address lists:", error);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error retrieving address lists: ${error.message}` 
                        }] 
                    };
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
                const headers = this.getClick2mailBasicAuthHeader();

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
        const apiKey = request.headers.get('mcp_token');
         
            if (!apiKey) {
                // If this logs, the client isn't sending the header.
                console.error("[DEBUG] Client did not send 'mcp_token' header.");
                return new Response("Missing mcp_token header.", { status: 401 }); 
            }
            ctx.props = {
                ...ctx.props, // Preserve any existing props
                toolExecutionApiKey: apiKey, // Use a descriptive, camelCase key
            };
       

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
}; 

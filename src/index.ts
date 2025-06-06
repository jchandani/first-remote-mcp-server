import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Placeholder types for serverless environment
type Env = { GOOGLE_API_KEY?: string; EASYPOST_API_KEY?: string; EASYPOST_CARRIER_ACCOUNT_ID?: string }; 
type ExecutionContext = any;

// Define Enums
export const LetterType = z.enum(['Letter 8.5 x 11', 'Letter 8.5 x 14']);
export type LetterType = z.infer<typeof LetterType>;

export const PostcardType = z.enum(['Postcard 4.25 x 6', 'Postcard 4 x 9', 'Postcard 5 x8']);
export type PostcardType = z.infer<typeof PostcardType>;

// Define Models using Zod
export const AddressSchema = z.object({
    name: z.string(),
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip_code: z.string(),
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

export const SendLetterInputSchema = z.object({
    to: AddressSchema,
    from_: AddressSchema,
    letter_type: LetterType,
});
export type SendLetterInput = z.infer<typeof SendLetterInputSchema>;

export const SendPostcardInputSchema = z.object({
    to: AddressSchema,
    from_: AddressSchema,
    postcard_type: PostcardType,
});
export type SendPostcardInput = z.infer<typeof SendPostcardInputSchema>;

// Helper function to get Basic Auth header for Click2mail
// Now accepts the base64 encoded credentials directly
function getClick2mailBasicAuthHeader(base64Credentials: string): HeadersInit {
     if (!base64Credentials) {
        throw new Error("Click2mail basic auth credentials are required.");
    }

    return {
        "Authorization": `Basic ${base64Credentials}`,
        "Accept": "application/json"
    };
}

// Helper function to get Bearer Auth header for EasyPost
function getEasyPostAuthHeader(env: Env): HeadersInit {
    const EASYPOST_API_KEY = env.EASYPOST_API_KEY;

    if (!EASYPOST_API_KEY) {
        throw new Error("Missing EasyPost API key in environment");
    }

    return {
        "Authorization": `Bearer ${EASYPOST_API_KEY}`,
        "Content-Type": "application/json",
    };
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
    server = new McpServer({
        name: "Click2mail",
        version: "1.0.0", // You might want to specify a version
    });

    private env: Env;
    private c2mAuthHeaderValue: string | undefined; // To store auth header value per request

    constructor(env: Env, c2mAuthHeaderValue?: string) {
        super();
        this.env = env;
        this.c2mAuthHeaderValue = c2mAuthHeaderValue;
    }

    async init() {
         if (!this.c2mAuthHeaderValue) {
             console.warn("Click2mail basic auth header value is not set for this agent instance.");
             // Depending on your requirements, you might want to throw an error here
             // if Click2mail tools are called without the necessary auth.
         }

        // Define Tools

        this.server.tool(
            "create_shipping_label",
            z.object({
                to_address_name: z.string(),
                to_address_street1: z.string(),
                to_address_city: z.string(),
                to_address_state: z.string(),
                to_address_zip: z.string(),
                to_address_country: z.string(),
                from_address_name: z.string(),
                from_address_street1: z.string(),
                from_address_city: z.string(),
                from_address_state: z.string(),
                from_address_zip: z.string(),
                from_address_country: z.string(),
                parcel_weight: z.string(),
            }),
            async (input) => {
                // Implement create_shipping_label logic based on easypost.py
                const url = "https://api.easypost.com/v2/shipments";
                const headers = getEasyPostAuthHeader(this.env);

                const payload = {
                    shipment: {
                        to_address: {
                            name: input.to_address_name,
                            street1: input.to_address_street1,
                            city: input.to_address_city,
                            state: input.to_address_state,
                            zip: input.to_address_zip,
                            country: input.to_address_country,
                            // Add phone and email if required by EasyPost API and available
                            // phone: "9234567890",
                            // email: "support@easypost.com"
                        },
                        from_address: {
                            name: input.from_address_name,
                            street1: input.from_address_street1,
                            city: input.from_address_city,
                            state: input.from_address_state,
                            zip: input.from_address_zip,
                            country: input.from_address_country,
                            // Add phone and email if required by EasyPost API and available
                            // phone: "9234567890",
                            // email: "support@easypost.com"
                        },
                        parcel: {
                            weight: parseFloat(input.parcel_weight) // Convert weight to number if needed
                        },
                        // TODO: Service and carrier_accounts might need to be inputs or configured
                        service: "Priority",
                        carrier_accounts: this.env.EASYPOST_CARRIER_ACCOUNT_ID ? [this.env.EASYPOST_CARRIER_ACCOUNT_ID] : undefined // Use array if multiple accounts
                    }
                };

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload),
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const labelUrl = data?.postage_label?.label_url;

                    if (labelUrl) {
                        return { content: [{ type: "text", text: labelUrl }] };
                    } else {
                        return { content: [{ type: "text", text: "Label URL not found in response." }] };
                    }

                } catch (error: any) {
                    console.error("Error creating shipping label:", error);
                    return { content: [{ type: "text", text: `Error creating shipping label: ${error.message}` }] };
                }
            }
        );

        this.server.tool(
            "view_proof",
            z.object({
                jobid: z.string(),
            }),
            async (input) => {
                // Implement view_proof logic based on Python code
                // Use the basic auth header value from the agent instance
                 if (!this.c2mAuthHeaderValue) {
                     return { content: [{ type: "text", text: "Click2mail basic auth credentials are not available." }] };
                 }

                const url = `https://stage-rest.click2mail.com/molpro/jobs/${input.jobid}/proof`;
                const headers = getClick2mailBasicAuthHeader(this.c2mAuthHeaderValue);
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: headers,
                        // fetch API doesn't have a direct timeout, consider using a library or AbortController
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        // Handle HTTP errors
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const statusUrl = data?.statusUrl;

                    if (statusUrl) {
                        return { content: [{ type: "text", text: statusUrl }] };
                    } else {
                        // Handle cases where statusUrl is not in the response
                        return { content: [{ type: "text", text: "Status URL not found in response." }] };
                    }

                } catch (error: any) {
                    console.error("Error viewing proof:", error);
                    return { content: [{ type: "text", text: `Error viewing proof: ${error.message}` }] };
                }
            }
        );

        this.server.tool(
            "job_status",
            z.object({
                jobid: z.string(),
            }),
            async (input) => {
                // Implement job_status logic based on Python code
                // Use the basic auth header value from the agent instance
                 if (!this.c2mAuthHeaderValue) {
                     return { content: [{ type: "text", text: "Click2mail basic auth credentials are not available." }] };
                 }

                const url = `https://stage-rest.click2mail.com/molpro/jobs/${input.jobid}`;
                const headers = getClick2mailBasicAuthHeader(this.c2mAuthHeaderValue);

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
                // Implement check_balance logic based on Python code
                // Use the basic auth header value from the agent instance
                 if (!this.c2mAuthHeaderValue) {
                     return { content: [{ type: "text", text: "Click2mail basic auth credentials are not available." }] };
                 }

                const url = `https://stage-rest.click2mail.com/molpro/credit`;
                const headers = getClick2mailBasicAuthHeader(this.c2mAuthHeaderValue);

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
            "send_letter",
            z.object({
                pdf_file: z.string(), // This might need adjustment for file uploads in TS MCP
                letter_type: z.string(),
                name: z.string(),
                address_lines: z.string(),
                locality: z.string(),
                postal_code: z.string(),
                region_code: z.string().default('US'),
            }),
            async (input) => {
                // Implement send_letter logic based on rest.py
                // Use the basic auth header value from the agent instance
                 if (!this.c2mAuthHeaderValue) {
                     return { content: [{ type: "text", text: "Click2mail basic auth credentials are not available." }] };
                 }
                // NOTE: Handling file uploads in TypeScript MCP and serverless environments
                // may require a different approach than reading local files directly.
                // The logic below translates the sequence of API calls from rest.py.

                const baseUrl = "https://stage-rest.click2mail.com/molpro/";
                const headers = getClick2mailBasicAuthHeader(this.c2mAuthHeaderValue);

                try {
                    // Step 1: Upload Document
                    // NOTE: Handling file uploads in TypeScript MCP and serverless environments
                    // may require a different approach than reading local files directly.
                    // The input.pdf_file is currently a string path, but needs to be file content (e.g., Blob, Buffer).
                    // You will likely need to adjust how the file content is accessed based on your environment.

                    const documentUploadUrl = baseUrl + "documents";
                    // In a real scenario, you would form a multipart/form-data request
                    // with the file content. This is a simplified placeholder using FormData.
                    // Replace 'fileBlob' and 'input.pdf_file' with your actual file handling logic.
                    const documentUploadBody = new FormData();
                    // Example: If input provides a File object directly
                    // if (input.pdf_file instanceof File) {
                    //     documentUploadBody.append('file', input.pdf_file, input.pdf_file.name);
                    // } else { /* Handle other input types like base64 string or buffer */ }

                    // *** IMPORTANT: Replace the following placeholder FormData append with your actual file content handling ***
                    // documentUploadBody.append('file', /* actual file content as Blob/Buffer */, input.pdf_file /* filename */);

                    documentUploadBody.append('documentFormat', 'pdf');
                    documentUploadBody.append('documentClass', input.letter_type); // Assuming letter_type maps to documentClass
                    documentUploadBody.append('documentName', 'uploaded_letter'); // Use a sensible name

                    // Headers for multipart/form-data are often set automatically by fetch/libraries
                    // when a FormData body is provided, but you might need to include the Authorization header.
                    const documentUploadHeaders = { ...headers }; // Include auth headers

                    const docResponse = await fetch(documentUploadUrl, {
                         method: 'POST',
                         headers: documentUploadHeaders, // Headers might need adjustment depending on library/env
                         body: documentUploadBody,
                     });

                     if (!docResponse.ok) {
                         const errorBody = await docResponse.text();
                         throw new Error(`Document upload failed: HTTP error! status: ${docResponse.status}, body: ${errorBody}`);
                     }
                     const docData: any = await docResponse.json();
                    // Replace "placeholder_doc_id" with the extracted ID from the response
                    const docId = docData?.id;

                    if (!docId) {
                         return { content: [{ type: "text", text: "Failed to get document ID after upload response." }] }; // Updated message
                     }

                    // Step 2: Create Address List
                    const addressListUrl = baseUrl + "addressLists";
                     const addressListHeaders = { ...headers, 'Content-Type': 'application/xml' };
                    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<addressList>
    <addressMappingId>1</addressMappingId>
    <addresses>
        <address>
            <Firstname>${input.name}</Firstname>
            <Lastname>${input.name}</Lastname>
            <Address1>${input.address_lines}</Address1>
            <City>${input.locality}</City>
            <State>${input.region_code}</State>
            <Postalcode>${input.postal_code}</Postalcode>
        </address>
    </addresses>
</addressList>`;

                    const addressListResponse = await fetch(addressListUrl, {
                        method: 'POST',
                        headers: addressListHeaders,
                        body: xmlPayload,
                    });

                    if (!addressListResponse.ok) {
                         const errorBody = await addressListResponse.text();
                        throw new Error(`Address list creation failed: HTTP error! status: ${addressListResponse.status}, body: ${errorBody}`);
                    }
                    const addressListData: any = await addressListResponse.json();
                    const listId = addressListData?.id;

                    if (!listId) {
                        return { content: [{ type: "text", text: "Failed to get address list ID after creation." }] };
                    }

                    // Step 3: Create Job
                    const jobUrl = baseUrl + "jobs";
                    const jobHeaders = { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' };
                    const jobFormData = new URLSearchParams();
                    jobFormData.append('documentClass', input.letter_type); // Assuming letter_type maps to documentClass
                    jobFormData.append('layout', 'Address on First Page'); // Hardcoded in Python
                    jobFormData.append('productionTime', 'Next Day'); // Hardcoded in Python
                    jobFormData.append('envelope', 'Best Fit'); // Hardcoded in Python
                    jobFormData.append('color', 'Full color'); // Hardcoded in Python
                    jobFormData.append('paperType', 'White 24#'); // Hardcoded in Python
                    jobFormData.append('printOption', 'Printing One side'); // Hardcoded in Python
                    jobFormData.append('mailClass', 'First class'); // Hardcoded in Python
                    jobFormData.append('documentId', docId);
                    jobFormData.append('addressId', listId);

                    const jobResponse = await fetch(jobUrl, {
                        method: 'POST',
                        headers: jobHeaders,
                        body: jobFormData.toString(),
                    });

                     if (!jobResponse.ok) {
                         const errorBody = await jobResponse.text();
                        throw new Error(`Job creation failed: HTTP error! status: ${jobResponse.status}, body: ${errorBody}`);
                    }

                    const jobData: any = await jobResponse.json();
                    const jobId = jobData?.id;

                    if (!jobId) {
                        return { content: [{ type: "text", text: "Failed to get job ID after creation." }] };
                    }

                    // Step 4: Submit Job
                    const submitUrl = baseUrl + `jobs/${jobId}/submit`;
                    const submitHeaders = { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' };
                    const submitFormData = new URLSearchParams();
                    submitFormData.append('billingType', 'User Credit'); // Hardcoded in Python

                    const submitResponse = await fetch(submitUrl, {
                        method: 'POST',
                        headers: submitHeaders,
                        body: submitFormData.toString(),
                    });

                    if (!submitResponse.ok) {
                         const errorBody = await submitResponse.text();
                         throw new Error(`Job submission failed: HTTP error! status: ${submitResponse.status}, body: ${errorBody}`);
                    }

                    // The Python code just prints the response text here and returns job_id
                    console.log("Job submission response:", await submitResponse.text());

                    return { content: [{ type: "text", text: `Letter (${input.letter_type}) sent. Your job id is ${jobId}` }] };

                } catch (error: any) {
                    console.error("Error sending letter:", error);
                    return { content: [{ type: "text", text: `Error sending letter: ${error.message}` }] };
                }
            }
        );

        this.server.tool(
            "send_postcard",
            z.object({
                input: SendPostcardInputSchema,
                // Note: Handling file uploads in TypeScript MCP might require a different approach
                // compared to FastAPI's UploadFile. This is a placeholder.
                pdf: z.any(), // Placeholder for file upload
            }),
            async (input) => {
                // TODO: Implement send_postcard logic here based on Python code
                // The Python code had a placeholder for this. You will need to
                // implement the API calls to send a postcard and handle the PDF file upload.
                console.log("send_postcard tool called with input:", input);
                return { content: [{ type: "text", text: `Placeholder for send postcard status` }] };
            }
        );

        this.server.tool(
            "validate_address",
            z.object({
                address_lines: z.string(),
                locality: z.string(),
                postal_code: z.string(),
                region_code: z.string().default('US'),
            }),
            async (input) => {
                // Implement validate_address logic based on Python code
                const GOOGLE_API_KEY = this.env.GOOGLE_API_KEY;
                 if (!GOOGLE_API_KEY) {
                     return { content: [{ type: "text", text: "Google API Key for address validation is not configured." }] };
                 }

                const url = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${GOOGLE_API_KEY}`;

                const payload = {
                    address: {
                        addressLines: [input.address_lines], // Address lines should be an array
                        locality: input.locality,
                        postalCode: input.postal_code,
                        regionCode: input.region_code,
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

                    const corrected = data?.result?.address;
                    const messages = data?.result?.validationMessages?.map((msg: any) => msg.text) || [];

                    const validationResult: AddressValidationResult = {
                        is_valid: is_valid,
                        corrected_address: corrected || {},
                        original_address: payload.address,
                        messages: messages,
                    };

                    return { content: [{ type: "json", json: validationResult }] };

                } catch (error: any) {
                     console.error("Error validating address:", error);
                     return { content: [{ type: "text", text: `Error validating address: ${error.message}` }] };
                }
            }
        );
    }
}

// Example serving block (adjust paths and environment variable handling as needed)
export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        // Extract C2M basic auth header value from query parameters (assuming 'c2m_auth' query param)
        const c2mAuthHeaderValue = url.searchParams.get('c2m_auth');

        // Create an instance of your agent with the environment variables and auth header
        const agent = new MyMCP(env, c2mAuthHeaderValue || undefined); // Pass undefined if not found
        agent.init(); // Initialize the tools

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            // Assuming serveSSE is a static method on McpServer or a related utility
            // If it's on the agent instance, you might need `agent.server.serveSSE(...)`
             // This part might need adjustment based on the actual MCP SDK API
            return (agent.server as any).serveSSE("/sse").fetch(request, env, ctx);
        }

        if (url.pathname === "/mcp") {
             // Assuming serve is a static method on McpServer or a related utility
             // If it's on the agent instance, you might need `agent.server.serve(...)`
             // This part might need adjustment based on the actual MCP SDK API
            return (agent.server as any).serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
}; 

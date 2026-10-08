// Server/worker use only. No OCR or external provider. Scanned/unsupported
// formats remain a visible human review item rather than invented text.
export async function extractDocument(bytes:Uint8Array,mime:string):Promise<{text:string;status:"extracted"|"needs_review"}> {
  if(bytes.byteLength>4*1024*1024)throw new Error("Processing limit exceeded.");
  if(mime.startsWith("text/")||mime==="application/json"){const text=new TextDecoder().decode(bytes).slice(0,100000);return {text,status:text.trim()?"extracted":"needs_review"};}
  if(mime!=="application/pdf")return {text:"",status:"needs_review"};
  try {
    const {PDFParse}=await import("pdf-parse");
    const parser=new PDFParse({data:bytes,isEvalSupported:false});
    try {
      const result=await parser.getText({first:25});
      const text=result.text.slice(0,100000);
      return {text,status:text.trim().length>30?"extracted":"needs_review"};
    } finally {await parser.destroy();}
  }catch{return {text:"",status:"needs_review"};}
}

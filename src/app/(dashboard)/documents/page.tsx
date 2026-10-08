import DocumentIntake,{type IntakeDocument} from "@/components/DocumentIntake";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
export const dynamic="force-dynamic";
export default async function DocumentsPage(){
  const access=await requireMember();if(!access.permissions.has("documents"))notFound();const db=await createClient();
  const [docs,types,companies,deals,sources,jobs,errors]=await Promise.all([
    db.from("documents").select("id,name,company_id,deal_id,drive_file_id,created_at,analysis:document_analysis(*),versions:document_versions(revision,created_at)").is("archived_at",null).order("created_at",{ascending:false}).limit(100),
    db.from("document_types").select("id,name").eq("is_active",true).order("name"),
    db.from("companies").select("id,name").is("deleted_at",null).order("name").limit(1000),
    db.from("deals").select("id,name,company_id").is("archived_at",null).order("name").limit(1000),
    db.from("drive_sources").select("id,folder_id,company_id,deal_id,enabled").order("created_at"),
    db.from("crm_sync_jobs").select("id,service,status,drive_source_id,error_code").eq("service","drive").order("created_at",{ascending:false}).limit(100),
    db.from("document_intake_errors").select("source_id,provider_id,code"),
  ]);
  const targets=[...(companies.data??[]).map(c=>({companyId:c.id,dealId:null,label:c.name})),...(deals.data??[]).map(d=>({companyId:d.company_id,dealId:d.id,label:`Round: ${d.name}`}))];
  return <div className="px-4 py-6 sm:px-7"><h1 className="text-[23px] font-semibold text-ink">Document intake</h1><p className="mb-5 mt-1 text-[13px] text-neutral-500">Import, classify and review documents. Showing the latest 100 files you can access.</p><DocumentIntake available={!docs.error} documents={(docs.data??[])as unknown as IntakeDocument[]} types={types.data??[]} targets={targets} sources={sources.data??[]} jobs={jobs.data??[]} errors={errors.data??[]}/></div>;
}

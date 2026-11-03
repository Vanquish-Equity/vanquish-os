import CompanyForm from "./CompanyForm";

export default function NewCompanyPage() {
  return (
    <div className="flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-7">
      <header>
        <h1 className="text-2xl font-semibold text-ink">New company</h1>
        <p className="mt-1 text-sm text-neutral-600">Create a company in the CRM without opening a deal.</p>
      </header>
      <CompanyForm />
    </div>
  );
}

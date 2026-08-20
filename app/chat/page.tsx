import ChatInterface from '../../components/chat/ChatInterface';

export default function Page({ searchParams }: { searchParams?: { clinic?: string } }) {
  const clinic = searchParams?.clinic ?? 'demo';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 p-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 rounded-lg bg-slate-800/60 px-6 py-4">
          <h1 className="text-2xl font-semibold text-slate-100">محادثة العيادة</h1>
          <p className="text-sm text-slate-300">تحدث مع موظفة الاستقبال الافتراضية للعيادة</p>
        </header>

        <main>
          <ChatInterface clinicId={clinic} />
        </main>
      </div>
    </div>
  );
}

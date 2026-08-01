export default function Dashboard() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 p-6 pt-12">
      <header className="w-full max-w-md">
        <h1 className="text-2xl font-bold">Homeroom</h1>
        <p className="text-sm text-gray-500">Family school dashboard</p>
      </header>
      <section className="w-full max-w-md space-y-3">
        {["Announcements", "Grades", "Events"].map((category) => (
          <div
            key={category}
            className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
          >
            <h2 className="font-semibold">{category}</h2>
            <p className="text-sm text-gray-500">
              Cards will appear here once sources are connected.
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}

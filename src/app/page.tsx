import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white border rounded-lg p-6">
        <h1 className="text-3xl font-bold mb-2">RoboChess3</h1>
        <p className="text-sm text-gray-600 mb-6">
          Choose an area to enter:
        </p>

        <div className="grid grid-cols-1 gap-3">
          <Link href="/coach" className="block rounded-md border p-4 hover:bg-gray-50">
            <div className="font-semibold">Coach</div>
            <div className="text-sm text-gray-600">Coach cabinet</div>
          </Link>

          <Link href="/student" className="block rounded-md border p-4 hover:bg-gray-50">
            <div className="font-semibold">Student</div>
            <div className="text-sm text-gray-600">Student cabinet</div>
          </Link>

          <Link href="/admin" className="block rounded-md border p-4 hover:bg-gray-50">
            <div className="font-semibold">Admin</div>
            <div className="text-sm text-gray-600">Admin panel</div>
          </Link>
        </div>
      </div>
    </div>
  );
}

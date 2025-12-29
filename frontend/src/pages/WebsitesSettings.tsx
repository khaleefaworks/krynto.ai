import WebsiteManagement from "./WebsiteManagement"

export default function WebsitesSettings() {
  return (
    <div className="flex h-screen">
      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-8">
        <WebsiteManagement />
      </main>
    </div>
  )
}

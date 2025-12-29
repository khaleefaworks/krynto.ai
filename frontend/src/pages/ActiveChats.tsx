import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { fetchActiveChats as fetchChatsApi } from '@/services/chats'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MessageSquare, Clock } from 'lucide-react'

export default function ActiveChats() {
  const navigate = useNavigate()
  const { activeChats, setActiveChats } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchActiveChats()
  }, [])

  const fetchActiveChats = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchChatsApi()
      setActiveChats(data)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch active chats')
      console.error('Failed to fetch active chats:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleJoinChat = (conversationId: number) => {
    navigate(`/dashboard/chats/${conversationId}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading chats...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-sm border border-gray-200 dark:border-gray-700 max-w-md">
          <p className="text-red-600 dark:text-red-400 mb-4 text-center">{error}</p>
          <Button onClick={fetchActiveChats} variant="outline" className="w-full">
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (activeChats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="text-center max-w-md">
          <div className="bg-gray-100 dark:bg-gray-800 rounded-full p-6 w-24 h-24 mx-auto mb-6 flex items-center justify-center">
            <MessageSquare className="h-12 w-12 text-gray-400 dark:text-gray-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No Active Chats</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">Waiting for visitors to start conversations...</p>
          <Button onClick={fetchActiveChats} variant="outline">
            Refresh
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 md:mb-8 gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Active Chats</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm md:text-base">{activeChats.length} conversation{activeChats.length !== 1 ? 's' : ''} waiting</p>
          </div>
          <Button onClick={fetchActiveChats} variant="outline" size="sm" className="dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 w-full sm:w-auto">
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {activeChats.map((chat) => (
            <Card 
              key={chat.id} 
              className="hover:shadow-lg transition-all cursor-pointer border-gray-200 dark:border-gray-700 dark:bg-gray-800 hover:scale-[1.02]"
              onClick={() => handleJoinChat(chat.id)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="truncate text-gray-900 dark:text-white">{chat.website_name || `Website ${chat.website_id}`}</span>
                  <span 
                    className={`text-xs px-3 py-1 rounded-full font-medium ml-2 whitespace-nowrap ${
                      chat.status === 'waiting' 
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' 
                        : chat.is_handoff 
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                    }`}
                  >
                    {chat.status}
                  </span>
                </CardTitle>
              </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {chat.last_message && (
                  <p className="text-gray-600 dark:text-gray-400 truncate italic">
                    "{chat.last_message}"
                  </p>
                )}
                <div className="flex items-center text-gray-500 dark:text-gray-400">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  <span>{chat.message_count} messages</span>
                </div>
                <div className="flex items-center text-gray-500 dark:text-gray-400">
                  <Clock className="h-4 w-4 mr-2" />
                  <span className="text-xs">Session: {chat.session_id.substring(0, 8)}...</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        </div>
      </div>
    </div>
  )
}

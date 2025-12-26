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
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading chats...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={fetchActiveChats} variant="outline">
          Retry
        </Button>
      </div>
    )
  }

  if (activeChats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <MessageSquare className="h-16 w-16 text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Active Chats</h3>
        <p className="text-gray-500">Waiting for visitors to start conversations...</p>
        <Button onClick={fetchActiveChats} variant="outline" className="mt-4">
          Refresh
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Active Chats</h2>
        <Button onClick={fetchActiveChats} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {activeChats.map((chat) => (
          <Card 
            key={chat.id} 
            className="hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => handleJoinChat(chat.id)}
          >
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="truncate">{chat.website_name || `Website ${chat.website_id}`}</span>
                <span 
                  className={`text-xs px-2 py-1 rounded ml-2 whitespace-nowrap ${
                    chat.status === 'waiting' 
                      ? 'bg-yellow-100 text-yellow-800' 
                      : chat.is_handoff 
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {chat.status}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {chat.last_message && (
                  <p className="text-gray-600 truncate">
                    "{chat.last_message}"
                  </p>
                )}
                <div className="flex items-center text-gray-500">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  <span>{chat.message_count} messages</span>
                </div>
                <div className="flex items-center text-gray-500">
                  <Clock className="h-4 w-4 mr-2" />
                  <span className="text-xs">Session: {chat.session_id.substring(0, 8)}...</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

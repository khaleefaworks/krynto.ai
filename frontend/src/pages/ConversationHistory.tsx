import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchClosedConversations } from '@/services/chats'
import type { ActiveChat } from '@/services/chats'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MessageSquare, Clock, Eye } from 'lucide-react'

export default function ConversationHistory() {
  const navigate = useNavigate()
  const [closedChats, setClosedChats] = useState<ActiveChat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchHistory()
  }, [])

  const fetchHistory = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchClosedConversations(undefined, undefined, 100)
      setClosedChats(data)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch conversation history')
      console.error('Failed to fetch history:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleViewChat = (conversationId: number) => {
    navigate(`/dashboard/history/${conversationId}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading conversation history...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={fetchHistory} variant="outline">
          Retry
        </Button>
      </div>
    )
  }

  if (closedChats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <MessageSquare className="h-16 w-16 text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Closed Conversations</h3>
        <p className="text-gray-500">Closed conversations will appear here</p>
        <Button onClick={fetchHistory} variant="outline" className="mt-4">
          Refresh
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Conversation History</h2>
        <Button onClick={fetchHistory} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {closedChats.map((chat) => (
          <Card 
            key={chat.id}
            className="hover:shadow-lg transition-shadow cursor-pointer border-gray-200"
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="text-sm font-medium">Chat #{chat.id}</span>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock className="h-3 w-3" />
                  <span>{chat.message_count} msgs</span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="text-sm">
                  <span className="font-medium text-gray-700">Website:</span>
                  <span className="ml-2 text-gray-600">{chat.website_name || `Website ${chat.website_id}`}</span>
                </div>
                
                <div className="text-sm">
                  <span className="font-medium text-gray-700">Last Message:</span>
                  <p className="text-gray-600 truncate mt-1">
                    {chat.last_message || 'No messages'}
                  </p>
                </div>

                <div className="text-xs text-gray-500 pt-2 border-t">
                  <div>Closed: {chat.closed_at ? new Date(chat.closed_at).toLocaleString() : 'N/A'}</div>
                  <div>Started: {chat.created_at ? new Date(chat.created_at).toLocaleString() : 'N/A'}</div>
                </div>

                <Button
                  onClick={() => handleViewChat(chat.id)}
                  className="w-full mt-3"
                  size="sm"
                  variant="outline"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Conversation
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

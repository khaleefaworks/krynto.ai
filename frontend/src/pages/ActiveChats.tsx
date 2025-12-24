import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MessageSquare, Clock } from 'lucide-react'

export default function ActiveChats() {
  const navigate = useNavigate()
  const { activeChats, setActiveChats } = useAppStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchActiveChats()
  }, [])

  const fetchActiveChats = async () => {
    try {
      // TODO: Replace with actual API endpoint
      const response = await fetch('http://localhost:8000/chats/active')
      const data = await response.json()
      setActiveChats(data)
    } catch (error) {
      console.error('Failed to fetch active chats:', error)
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
          <Card key={chat.id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Chat #{chat.id}</span>
                {chat.is_handoff && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Active
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center text-gray-600">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  <span>{chat.message_count} messages</span>
                </div>
                <div className="flex items-center text-gray-600">
                  <Clock className="h-4 w-4 mr-2" />
                  <span>Session: {chat.session_id.substring(0, 8)}...</span>
                </div>
                <div className="pt-2">
                  <Button
                    onClick={() => handleJoinChat(chat.id)}
                    className="w-full"
                    variant={chat.is_handoff ? 'secondary' : 'default'}
                  >
                    {chat.is_handoff ? 'View Chat' : 'Join Chat'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

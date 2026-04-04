import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { clearToken } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SuperAdminHome() {
    const navigate = useNavigate()
    const { user, setUser, setToken } = useAppStore()

    const onLogout = () => {
        clearToken()
        setUser(null)
        setToken(null)
        navigate('/login', { replace: true })
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="mx-auto max-w-3xl">
                <Card>
                    <CardHeader>
                        <CardTitle>Super Admin Portal</CardTitle>
                        <CardDescription>
                            Signed in as {user?.email || 'system manager'}. This portal is intentionally separate from the agent dashboard.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-sm text-slate-600">
                            You are correctly routed to the platform admin area. Organization management pages will live under /superadmin/*.
                        </p>
                        <div className="flex gap-3">
                            <Button onClick={onLogout} variant="outline">Logout</Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

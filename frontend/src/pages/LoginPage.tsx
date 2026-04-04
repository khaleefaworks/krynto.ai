import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { saveToken } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import Logo from '@/components/Logo'
import { API_BASE } from '@/config/endpoints'

const loginSchema = z.object({
  email: z.string().min(1, 'Email or username is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const setupMessage = sessionStorage.getItem('setup_success') || ((location.state as any)?.message as string | undefined)
  if (setupMessage) sessionStorage.removeItem('setup_success')
  const { setUser, setToken, setOrganization } = useAppStore()
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    try {
      setError(null)
      // Use raw fetch so we can detect needs_verification before it reaches loginApi's
      // type-narrowing (which expects access_token to always be present).
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.detail || 'Login failed')
      }

      // Email not yet verified — send to OTP step on the signup page
      if (result.needs_verification) {
        navigate('/signup', { state: { step: 'verify', email: result.email }, replace: true })
        return
      }

      const response = result

      // Save token to localStorage
      saveToken(response.access_token)

      // Update store
      setUser(response.user)
      setToken(response.access_token)

      // Fetch org details for non-super-admin users
      if (response.user.role !== 'system_manager' && response.user.organization_id) {
        try {
          const orgRes = await fetch(`${API_BASE}/organization`, {
            headers: { Authorization: `Bearer ${response.access_token}` },
          })
          if (orgRes.ok) setOrganization(await orgRes.json())
        } catch { /* non-critical */ }
      }

      if (response.user.role === 'system_manager') {
        navigate('/superadmin/organizations', { replace: true })
      } else {
        navigate('/dashboard/chats', { replace: true })
      }
    } catch (err: any) {
      setError(err.message || 'Login failed')
      console.error('Login failed:', err)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md dark:bg-gray-800 dark:border-gray-700">
        <CardHeader className="space-y-3">
          <div className="flex justify-center">
            <Logo size={64} />
          </div>
          <CardTitle className="text-2xl dark:text-white text-center">Agent Login</CardTitle>
          <CardDescription className="dark:text-gray-400 text-center">
            Sign in to access the agent dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {setupMessage && (
              <div className="p-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md">
                {setupMessage}
              </div>
            )}
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email / Username
              </label>
              <Input
                id="email"
                type="text"
                placeholder="agent@example.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-sm text-red-600 mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  {...register('password')}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-red-600 mt-1">{errors.password.message}</p>
              )}
              <div className="text-right">
                <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
            New here?{' '}
            <Link to="/signup" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
              Sign up for free
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

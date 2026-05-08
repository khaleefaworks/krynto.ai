import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { saveToken } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Mail } from 'lucide-react'
import Logo from '@/components/Logo'
import { API_BASE } from '@/config/endpoints'

type Step = 'loading' | 'invalid' | 'pending' | 'otp'

export default function VerifyEmailPage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token') || ''
    const { setUser, setToken, setOrganization } = useAppStore()

    const [step, setStep] = useState<Step>('loading')
    const [email, setEmail] = useState('')
    const [invalidMsg, setInvalidMsg] = useState('')
    const [otp, setOtp] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [sendLoading, setSendLoading] = useState(false)
    const [otpLoading, setOtpLoading] = useState(false)
    const [resendLoading, setResendLoading] = useState(false)
    const [resendMsg, setResendMsg] = useState<string | null>(null)

    // On mount: validate the token and retrieve the user's email for display
    useEffect(() => {
        if (!token) {
            setInvalidMsg('No verification token found. Please use the link from your email.')
            setStep('invalid')
            return
        }

        fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`)
            .then(r => r.json())
            .then(data => {
                if (data.valid) {
                    setEmail(data.email)
                    setStep('pending')
                } else {
                    setInvalidMsg(data.message || 'This verification link is invalid or has expired.')
                    setStep('invalid')
                }
            })
            .catch(() => {
                setInvalidMsg('Unable to validate the link. Please try again.')
                setStep('invalid')
            })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleSendOtp = async () => {
        setSendLoading(true)
        setError(null)
        try {
            const res = await fetch(`${API_BASE}/auth/send-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || 'Failed to send verification code.')
            }
            const data = await res.json()
            setEmail(data.email || email)
            setStep('otp')
        } catch (err: any) {
            setError(err.message || 'Failed to send verification code. Please try again.')
        } finally {
            setSendLoading(false)
        }
    }

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!otp.trim()) { setError('Please enter the verification code.'); return }
        setOtpLoading(true)
        setError(null)
        try {
            const res = await fetch(`${API_BASE}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp: otp.trim() }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || 'Invalid or expired code.')
            }
            const result = await res.json()
            saveToken(result.access_token)
            setUser(result.user)
            setToken(result.access_token)
            try {
                const orgRes = await fetch(`${API_BASE}/organization`, {
                    headers: { Authorization: `Bearer ${result.access_token}` },
                })
                if (orgRes.ok) setOrganization(await orgRes.json())
            } catch { /* non-critical */ }
            navigate('/dashboard/chats', { replace: true })
        } catch (err: any) {
            setError(err.message || 'Verification failed.')
        } finally {
            setOtpLoading(false)
        }
    }

    const handleResend = async () => {
        setResendLoading(true)
        setResendMsg(null)
        setError(null)
        try {
            await fetch(`${API_BASE}/auth/resend-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            })
            setResendMsg('A new code has been sent.')
        } catch {
            setResendMsg('Could not resend code. Please try again.')
        } finally {
            setResendLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
            <Card className="w-full max-w-md shadow-xl dark:bg-gray-800 dark:border-gray-700">
                <CardHeader className="space-y-3 text-center">
                    <div className="flex justify-center">
                        <Logo size={48} />
                    </div>
                    {step === 'loading' && (
                        <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">Checking link…</CardTitle>
                    )}
                    {step === 'invalid' && (
                        <>
                            <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">Link invalid</CardTitle>
                            <CardDescription className="dark:text-gray-400">
                                This verification link has expired or already been used.
                            </CardDescription>
                        </>
                    )}
                    {step === 'pending' && (
                        <>
                            <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">Verify your email</CardTitle>
                            <CardDescription className="dark:text-gray-400">
                                Confirm your email address to continue.
                            </CardDescription>
                        </>
                    )}
                    {step === 'otp' && (
                        <>
                            <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">Verify your email</CardTitle>
                            <CardDescription className="dark:text-gray-400">
                                We sent a 6-digit code to <strong>{email}</strong>. Enter it below to continue.
                            </CardDescription>
                        </>
                    )}
                </CardHeader>

                <CardContent>
                    {step === 'loading' && (
                        <div className="flex justify-center py-8">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                        </div>
                    )}

                    {step === 'invalid' && (
                        <div className="space-y-4">
                            <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                                {invalidMsg}
                            </div>
                            <div className="text-center">
                                <Link
                                    to="/login"
                                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                                >
                                    ← Back to login
                                </Link>
                            </div>
                        </div>
                    )}

                    {step === 'pending' && (
                        <div className="space-y-4">
                            {error && (
                                <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                                    {error}
                                </div>
                            )}

                            <div className="flex items-start gap-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3">
                                <Mail className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                                <p className="text-sm text-blue-700 dark:text-blue-300">
                                    A 6-digit verification code will be sent to{' '}
                                    <strong className="font-semibold">{email}</strong>
                                </p>
                            </div>

                            <Button
                                type="button"
                                onClick={handleSendOtp}
                                disabled={sendLoading}
                                className="w-full"
                            >
                                {sendLoading ? 'Sending…' : 'Send verification code'}
                            </Button>

                            <div className="text-center">
                                <Link
                                    to="/login"
                                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                >
                                    ← Back to login
                                </Link>
                            </div>
                        </div>
                    )}

                    {step === 'otp' && (
                        <form onSubmit={handleVerifyOtp} className="space-y-4">
                            {error && (
                                <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                                    {error}
                                </div>
                            )}
                            {resendMsg && (
                                <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-700 dark:text-green-300">
                                    {resendMsg}
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    6-digit verification code
                                </label>
                                <Input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={otp}
                                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                                    autoComplete="one-time-code"
                                    className="text-center text-2xl tracking-widest font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    autoFocus
                                />
                            </div>

                            <Button type="submit" disabled={otpLoading || otp.length < 6} className="w-full">
                                {otpLoading ? 'Verifying…' : 'Verify & continue'}
                            </Button>

                            <div className="text-center text-sm text-gray-500 dark:text-gray-400">
                                Didn't receive a code?{' '}
                                <button
                                    type="button"
                                    onClick={handleResend}
                                    disabled={resendLoading}
                                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium disabled:opacity-50"
                                >
                                    {resendLoading ? 'Sending…' : 'Resend code'}
                                </button>
                            </div>

                            <div className="text-center">
                                <Link
                                    to="/login"
                                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                >
                                    ← Back to login
                                </Link>
                            </div>
                        </form>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

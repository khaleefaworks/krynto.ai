import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { saveToken } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useState, useEffect } from 'react'
import { Eye, EyeOff, Mail } from 'lucide-react'
import Logo from '@/components/Logo'
import { API_BASE } from '@/config/endpoints'

const signupSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    organization_name: z.string().min(2, 'Organization name must be at least 2 characters'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
})

type SignupForm = z.infer<typeof signupSchema>

export default function SignupPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const locationState = location.state as { step?: string; email?: string } | null
    const { setUser, setToken, setOrganization } = useAppStore()
    const [error, setError] = useState<string | null>(null)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    // Track whether the user arrived from a login redirect (vs organic signup)
    const cameFromLogin = locationState?.step === 'verify'

    // OTP step state — can be pre-seeded by login redirect.
    // When coming from login (unverified account), skip verify_pending and go
    // directly to the OTP input so the user doesn't have to click "Send OTP" again.
    const [step, setStep] = useState<'signup' | 'verify_pending' | 'verify'>(
        cameFromLogin ? 'verify' : 'signup'
    )
    const [pendingEmail, setPendingEmail] = useState(locationState?.email || '')
    const [otp, setOtp] = useState('')
    const [otpLoading, setOtpLoading] = useState(false)
    const [resendLoading, setResendLoading] = useState(false)
    const [resendMsg, setResendMsg] = useState<string | null>(null)
    const [sendOtpLoading, setSendOtpLoading] = useState(false)

    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SignupForm>({
        resolver: zodResolver(signupSchema),
        defaultValues: { name: '', email: '', organization_name: '', password: '', confirmPassword: '' },
    })

    // When landing on this page from a login redirect (email not yet verified),
    // reset the form so react-hook-form's internal state is clean,
    // and auto-send the OTP so the user can immediately enter the code.
    useEffect(() => {
        if (locationState?.step !== 'verify') { reset(); return }
        reset()
        // Auto-send OTP for login-redirect flow (user already registered, just not verified yet)
        if (locationState?.email) {
            fetch(`${API_BASE}/auth/resend-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: locationState.email }),
            }).catch(() => { /* best-effort */ })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const onSubmit = async (data: SignupForm) => {
        try {
            setError(null)
            const response = await fetch(`${API_BASE}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: data.name,
                    email: data.email,
                    organization_name: data.organization_name,
                    password: data.password,
                }),
            })
            if (!response.ok) {
                const err = await response.json().catch(() => ({}))
                const msg = err.detail || err.message || 'Signup failed'
                throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
            }
            const result = await response.json()

            if (result.needs_verification) {
                // Show pending step — user must explicitly request the code
                setPendingEmail(result.email || data.email)
                setStep('verify_pending')
                return
            }

            // Fallback: if server somehow returns a token directly
            await _loginWithToken(result)
        } catch (err: any) {
            setError(err.message || 'Signup failed')
        }
    }

    const _loginWithToken = async (result: { access_token: string; user: any }) => {
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
    }

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!otp.trim()) { setError('Please enter the verification code.'); return }
        setOtpLoading(true)
        setError(null)
        try {
            const response = await fetch(`${API_BASE}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: pendingEmail, otp: otp.trim() }),
            })
            if (!response.ok) {
                const err = await response.json().catch(() => ({}))
                throw new Error(err.detail || 'Invalid or expired code.')
            }
            const result = await response.json()
            await _loginWithToken(result)
        } catch (err: any) {
            setError(err.message || 'Verification failed.')
        } finally {
            setOtpLoading(false)
        }
    }

    const handleSendOtp = async () => {
        setSendOtpLoading(true)
        setError(null)
        try {
            await fetch(`${API_BASE}/auth/resend-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: pendingEmail }),
            })
            setStep('verify')
        } catch {
            setError('Failed to send verification code. Please try again.')
        } finally {
            setSendOtpLoading(false)
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
                body: JSON.stringify({ email: pendingEmail }),
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
                    {step === 'signup' ? (
                        <>
                            <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">Create a free account</CardTitle>
                            <CardDescription className="dark:text-gray-400">
                                Get started with AI ChatAssist — free forever, no card required.
                            </CardDescription>
                        </>
                    ) : step === 'verify_pending' ? (
                        <>
                            <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">Verify your email</CardTitle>
                            <CardDescription className="dark:text-gray-400">
                                Confirm your email address to continue.
                            </CardDescription>
                        </>
                    ) : (
                        <>
                            <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">Verify your email</CardTitle>
                            <CardDescription className="dark:text-gray-400">
                                We sent a 6-digit code to <strong>{pendingEmail}</strong>. Enter it below to continue.
                            </CardDescription>
                        </>
                    )}
                </CardHeader>
                <CardContent>
                    {step === 'signup' ? (
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            {error && (
                                <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                                    {error}
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Your name</label>
                                <Input placeholder="Alice Smith" {...register('name')} className="dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Work email</label>
                                <Input type="email" placeholder="alice@acme.com" {...register('email')} className="dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Organization name</label>
                                <Input placeholder="Acme Corp" {...register('organization_name')} className="dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                {errors.organization_name && <p className="text-xs text-red-500">{errors.organization_name.message}</p>}
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                                <div className="relative">
                                    <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Min. 8 characters" {...register('password')} className="pr-10 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                    <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700">
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Confirm password</label>
                                <div className="relative">
                                    <Input type={showConfirm ? 'text' : 'password'} autoComplete="new-password" placeholder="Repeat password" {...register('confirmPassword')} className="pr-10 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                    <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700">
                                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                {errors.confirmPassword && <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>}
                            </div>

                            <Button type="submit" disabled={isSubmitting} className="w-full mt-2">
                                {isSubmitting ? 'Creating account…' : 'Create free account'}
                            </Button>
                        </form>
                    ) : step === 'verify_pending' ? (
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
                                    <strong className="font-semibold">{pendingEmail}</strong>
                                </p>
                            </div>

                            <Button
                                type="button"
                                onClick={handleSendOtp}
                                disabled={sendOtpLoading}
                                className="w-full"
                            >
                                {sendOtpLoading ? 'Sending…' : 'Send verification code'}
                            </Button>

                            <div className="text-center">
                                {cameFromLogin ? (
                                    <button
                                        type="button"
                                        onClick={() => navigate('/login')}
                                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                    >
                                        ← Back to login
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => { setStep('signup'); setError(null); reset() }}
                                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                    >
                                        ← Back to signup
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
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
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">6-digit verification code</label>
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
                                <button
                                    type="button"
                                    onClick={() => { setStep('signup'); setOtp(''); setError(null); setResendMsg(null); reset() }}
                                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                >
                                    ← Back to signup
                                </button>
                            </div>
                        </form>
                    )}

                    {step === 'signup' && (
                        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
                            Already have an account?{' '}
                            <Link to="/login" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                                Sign in
                            </Link>
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

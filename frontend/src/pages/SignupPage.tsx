import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useState } from 'react'
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
    const [error, setError] = useState<string | null>(null)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [step, setStep] = useState<'signup' | 'check_email'>('signup')
    const [pendingEmail, setPendingEmail] = useState('')

    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignupForm>({
        resolver: zodResolver(signupSchema),
        defaultValues: { name: '', email: '', organization_name: '', password: '', confirmPassword: '' },
    })

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
                // Backend has sent a welcome email with a verification link.
                // Show a "check your inbox" screen — the user continues from the email.
                setPendingEmail(result.email || data.email)
                setStep('check_email')
                return
            }

            // Fallback: server returned a token directly (unexpected but handle gracefully)
            navigate('/dashboard/chats', { replace: true })
        } catch (err: any) {
            setError(err.message || 'Signup failed')
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
                    ) : (
                        <>
                            <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">Check your inbox</CardTitle>
                            <CardDescription className="dark:text-gray-400">
                                We've sent a verification link to your email address.
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
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3">
                                <Mail className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                                <p className="text-sm text-blue-700 dark:text-blue-300">
                                    A verification link has been sent to{' '}
                                    <strong className="font-semibold">{pendingEmail}</strong>.
                                    Click the link in the email to continue.
                                </p>
                            </div>

                            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                                The link expires in 2 hours. Check your spam folder if you don't see it.
                            </p>

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

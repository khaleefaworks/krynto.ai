import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import Logo from '@/components/Logo'
import { apiRequest } from '@/services/api'

const schema = z.object({
    email: z.string().email('Please enter a valid email address'),
})

type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
    const [submitted, setSubmitted] = useState(false)
    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
        resolver: zodResolver(schema),
    })

    const onSubmit = async (data: FormData) => {
        try {
            await apiRequest('/auth/forgot-password', {
                method: 'POST',
                body: JSON.stringify({ email: data.email.trim().toLowerCase() }),
            })
        } catch {
            // Intentionally swallow errors — always show the same generic message
            // so we don't leak whether an account exists for a given email.
        }
        setSubmitted(true)
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <Logo size={48} />
                    </div>
                    <CardTitle>Forgot password</CardTitle>
                    <CardDescription>
                        Enter your email and we'll send you a reset link.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {submitted ? (
                        <div className="text-center space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                If an account exists for that email, you'll receive a password reset link shortly. Please check your inbox.
                            </p>
                            <Link to="/login" className="text-sm text-primary hover:underline">
                                Back to sign in
                            </Link>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium mb-1">
                                    Email address
                                </label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="you@example.com"
                                    {...register('email')}
                                />
                                {errors.email && (
                                    <p className="text-sm text-red-600 mt-1">{errors.email.message}</p>
                                )}
                            </div>
                            <Button type="submit" className="w-full" disabled={isSubmitting}>
                                {isSubmitting ? 'Sending...' : 'Send reset link'}
                            </Button>
                            <p className="text-center text-sm text-gray-500">
                                <Link to="/login" className="text-primary hover:underline">
                                    Back to sign in
                                </Link>
                            </p>
                        </form>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

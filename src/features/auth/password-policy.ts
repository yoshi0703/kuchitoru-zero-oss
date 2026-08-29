export const PASSWORD_REQUIREMENTS = '8文字以上で、英大文字・英小文字・数字・記号をそれぞれ1文字以上含めてください。'
export const PASSWORD_REQUIREMENTS_ERROR = 'パスワードの条件を満たしていません。'
export const PASSWORD_REQUIREMENTS_EN = 'Use at least 8 characters, including an uppercase letter, a lowercase letter, a number, and a symbol.'
export const PASSWORD_REQUIREMENTS_ERROR_EN = 'The password does not meet the requirements.'

export function passwordMeetsRequirements(password: string) {
  return password.length >= 8
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password)
}

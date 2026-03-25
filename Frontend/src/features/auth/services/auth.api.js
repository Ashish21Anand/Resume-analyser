import axios from "axios"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://resume-analyser-5otu.onrender.com"
const TOKEN_KEY = "authToken"

const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true
})

api.interceptors.request.use((config) => {
    const token = localStorage.getItem(TOKEN_KEY)

    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    }

    return config
})

function persistToken(token) {
    if (token) {
        localStorage.setItem(TOKEN_KEY, token)
    }
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY)
}

export async function register({ username, email, password }) {

    try {
        const response = await api.post('/api/auth/register', {
            username, email, password
        })

        persistToken(response.data.token)
        return response.data

    } catch (err) {
        throw err

    }

}

export async function login({ email, password }) {

    try {

        const response = await api.post("/api/auth/login", {
            email, password
        })

        persistToken(response.data.token)
        return response.data

    } catch (err) {
        throw err
    }

}

export async function logout() {
    try {

        const response = await api.get("/api/auth/logout")
        clearToken()

        return response.data

    } catch (err) {
        clearToken()
        throw err
    }
}

export async function getMe() {

    try {

        const response = await api.get("/api/auth/get-me")

        return response.data

    } catch (err) {
        if (err.response?.status === 401) {
            clearToken()
        }

        throw err
    }

}

import { render } from 'preact'
import '../tokens.css'
import { Onboarding } from './Onboarding'

const root = document.getElementById('root')
if (root) render(<Onboarding />, root)

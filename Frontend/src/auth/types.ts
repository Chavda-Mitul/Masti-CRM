/** HEAD: every department. OFFICE: desktop CRM through department roles. FIELD: the /tasks phone view only. */
export type UserType = 'HEAD' | 'OFFICE' | 'FIELD'
export type DepartmentRole = 'STAFF' | 'HOD'
export type Access = 'VIEW' | 'EDIT'

export interface UserDepartment {
  code: string
  name: string
  role: DepartmentRole
  access: Access
}

export interface User {
  id: string
  name: string
  mobile: string | null
  email: string | null
  type: UserType
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  departments: UserDepartment[]
}

export interface Department {
  code: string
  name: string
  sortOrder: number
}
